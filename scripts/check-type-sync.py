#!/usr/bin/env python3
"""Rust serde 类型 ↔ TS 接口字段对账（同名类型）。

对 src-tauri/src/types/*.rs 中每个 `pub struct`，按 `#[serde(rename_all = ...)]` 与字段级
`#[serde(rename = ...)]` 计算实际 JSON 键；与 src/ 下同名 `export interface` 的字段比较：
  E  TS 声明了但 Rust 不输出的键（前端读到 undefined）—— 只对 Rust 侧可序列化的类型报告
  W  Rust 输出但 TS 未声明的键（信息不完整，通常无害）
TS 侧可选字段（`?:`）缺失不报 E。只证明字段名一致，不证明类型一致。

用法: python3 scripts/check-type-sync.py [--warn]   （默认只打印 E；--warn 同时打印 W）
退出码: 存在 E 时为 1；已登记在 KNOWN_MISMATCH 的类型只报告不计入失败。
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 已知不一致、尚未修复的类型：只报告，不让 verify 失败（修复后从这里删除）
KNOWN_MISMATCH: set[str] = set()

# 前端内部的请求 DTO：service 发送前显式转换为 snake_case 键，TS 形状不必与 Rust 一致
FRONTEND_DTO = {
    'StudyPlanScheduleRequest',            # studyService.generateStudyPlanSchedule → backendRequest
    'CreateStudyPlanWithScheduleRequest',  # studyService.createStudyPlanWithSchedule → backendRequest
}

# TS 接口实际对应的 Rust 类型（返回给前端的是脱敏的 *Safe 版本）
TS_TO_RUST = {
    'AIProvider': 'AIProviderSafe',
    'AIModelConfig': 'AIModelConfigSafe',
    'TtsConfig': 'TtsConfigSafe',
}


def snake_to_camel(s: str) -> str:
    head, *rest = s.split('_')
    return head + ''.join(p[:1].upper() + p[1:] for p in rest)


def rename(field: str, rule: str | None) -> str:
    if rule == 'camelCase':
        return snake_to_camel(field)
    if rule == 'PascalCase':
        c = snake_to_camel(field)
        return c[:1].upper() + c[1:]
    if rule == 'lowercase':
        return field.lower()
    if rule == 'UPPERCASE':
        return field.upper()
    if rule == 'kebab-case':
        return field.replace('_', '-')
    return field  # snake_case / 无规则


def rust_structs() -> dict[str, tuple[dict[str, str], str]]:
    """name -> ({json_key: rust_field}, file)"""
    out = {}
    # types/ 之外返回给前端的 serde 结构也在这里登记
    extra = [os.path.join(ROOT, f) for f in (
        'src-tauri/src/agent/catalog.rs',          # pi 目录（CatalogModel / CatalogProviderSummary）
        'src-tauri/src/planning_progress.rs',      # 规划进度（AnalysisProgress，前端轮询）
        'src-tauri/src/prompts.rs',                # 学习者档案预览（PromptPreview）
        'src-tauri/src/services/prompt_profile.rs', # PromptProfile
        'src-tauri/src/services/agent_settings.rs', # AgentSettings / UpdateAgentSettingsRequest
        'src-tauri/src/services/plan_pace.rs',      # PlanPaceResult
    ) if os.path.exists(os.path.join(ROOT, f))]
    for path in glob.glob(os.path.join(ROOT, 'src-tauri/src/types/*.rs')) + extra:
        text = open(path, encoding='utf-8').read()
        for m in re.finditer(r'((?:\s*#\[[^\]]*\]\s*|\s*///[^\n]*\n)*)\s*pub struct (\w+)\s*\{(.*?)\n\}', text, re.S):
            attrs, name, body = m.group(1), m.group(2), m.group(3)
            if 'Serialize' not in attrs:
                continue
            rule_m = re.search(r'rename_all\s*=\s*"([^"]+)"', attrs)
            rule = rule_m.group(1) if rule_m else None
            fields = {}
            pending_rename = None
            skip = False
            for line in body.split('\n'):
                line = line.strip()
                rm = re.search(r'#\[serde\([^)]*rename\s*=\s*"([^"]+)"', line)
                if rm:
                    pending_rename = rm.group(1)
                if re.search(r'#\[serde\([^)]*skip(_serializing)?\b', line):
                    skip = True
                fm = re.match(r'pub\s+(\w+)\s*:', line)
                if fm:
                    if not skip:
                        key = pending_rename or rename(fm.group(1), rule)
                        fields[key] = fm.group(1)
                    pending_rename, skip = None, False
            out[name] = (fields, os.path.relpath(path, ROOT))
    return out


def ts_interfaces() -> dict[str, tuple[dict[str, bool], str]]:
    """name -> ({field: optional}, file)"""
    out = {}
    files = glob.glob(os.path.join(ROOT, 'src/**/*.ts'), recursive=True)
    for path in files:
        if path.endswith('.test.ts') or path.endswith('.d.ts'):
            continue
        text = open(path, encoding='utf-8').read()
        for m in re.finditer(r'export interface (\w+)(?:\s+extends[^{]+)?\s*\{(.*?)\n\}', text, re.S):
            name, body = m.group(1), m.group(2)
            fields = {}
            depth = 0
            for line in body.split('\n'):
                s = line.strip()
                if depth == 0:
                    fm = re.match(r"^['\"]?([A-Za-z_][\w]*)['\"]?(\??)\s*:", s)
                    if fm:
                        fields[fm.group(1)] = fm.group(2) == '?'
                depth += s.count('{') - s.count('}')
            if name not in out:  # 以首次定义为准
                out[name] = (fields, os.path.relpath(path, ROOT))
    return out


def main() -> int:
    show_warn = '--warn' in sys.argv
    rs, ts = rust_structs(), ts_interfaces()
    errors = warnings = 0
    checked = 0
    for name in sorted(n for n in ts if TS_TO_RUST.get(n, n) in rs and n not in FRONTEND_DTO):
        r_fields, r_file = rs[TS_TO_RUST.get(name, name)]
        t_fields, t_file = ts[name]
        checked += 1
        missing_in_rust = [f for f, opt in t_fields.items() if f not in r_fields and not opt]
        missing_in_ts = [k for k in r_fields if k not in t_fields]
        if missing_in_rust:
            tag = 'known' if name in KNOWN_MISMATCH else 'E'
            if tag == 'E':
                errors += 1
            print(f'{tag} {name}: TS 必填字段在 Rust 输出中不存在 {missing_in_rust}\n'
                  f'    TS {t_file}  ↔  Rust {r_file}（Rust 键: {sorted(r_fields)}）')
        if missing_in_ts and show_warn:
            warnings += 1
            print(f'W {name}: Rust 输出但 TS 未声明 {missing_in_ts}  ({t_file})')
    print(f'check-type-sync: 同名类型 {checked} 个, errors={errors}' + (f', warnings={warnings}' if show_warn else ''))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
