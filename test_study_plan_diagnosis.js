// 测试学习计划诊断脚本
// 在浏览器控制台中运行

async function diagnoseStudyPlan() {
  console.log('🔍 开始诊断学习计划数据...');
  
  try {
    // 调用诊断API
    const result = await window.__TAURI__.core.invoke('diagnose_study_plan_data', { planName: '测试计划-edit' });
    console.log('✅ 诊断结果:', result);
    
    if (result.plans && result.plans.length > 0) {
      result.plans.forEach(plan => {
        console.log(`📋 学习计划: ${plan.name} (ID: ${plan.id})`);
        console.log(`  - 状态: ${plan.status} / ${plan.unified_status}`);
        console.log(`  - 总单词数: ${plan.total_words}`);
        console.log(`  - 已学单词数: ${plan.learned_words}`);
        console.log(`  - 有AI数据: ${plan.has_ai_data ? '是' : '否'}`);
        console.log(`  - AI数据长度: ${plan.ai_data_length}`);
        console.log(`  - 日程数量: ${plan.schedule_count}`);
        console.log(`  - 单词关联数量: ${plan.word_count}`);
        
        if (!plan.has_ai_data) {
          console.log('  ⚠️  该计划没有AI规划数据');
        }
        if (plan.schedule_count === 0) {
          console.log('  ⚠️  该计划没有日程安排');
        }
        if (plan.word_count === 0) {
          console.log('  ⚠️  该计划没有单词关联');
        }
      });
    } else {
      console.log('❌ 没有找到匹配的学习计划');
    }
    
  } catch (error) {
    console.error('❌ 诊断失败:', error);
  }
}

// 运行诊断
diagnoseStudyPlan();
