import { useEffect, useState } from 'react';
import { tagService } from '@/services/tagService';
import type { MaterialSettings } from '@/types/material';

/** 读一次后缓存（设置页保存时更新），各页面打开时直接拿到默认值 */
let cached: MaterialSettings | null = null;
let pending: Promise<MaterialSettings | null> | null = null;

export function loadMaterialSettings(): Promise<MaterialSettings | null> {
  if (cached) return Promise.resolve(cached);
  pending ??= tagService.getMaterialSettings().then((r) => {
    pending = null;
    if (r.success) cached = r.data;
    return cached;
  });
  return pending;
}

export function setCachedMaterialSettings(settings: MaterialSettings) {
  cached = settings;
}

/** 素材处理的默认值（「设置 → 素材」）；没读到时为 null（页面用自己的内置默认） */
export function useMaterialSettings(): MaterialSettings | null {
  const [settings, setSettings] = useState<MaterialSettings | null>(cached);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    void loadMaterialSettings().then((s) => alive && setSettings(s));
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}
