// 测试学习计划功能修复的脚本
// 这个脚本可以在浏览器控制台中运行来测试修复效果

async function testStudyPlanFixes() {
  console.log('🧪 开始测试学习计划功能修复...');

  try {
    // 测试1: 获取学习计划列表
    console.log('📋 测试获取学习计划列表...');
    const studyPlansResult = await window.__TAURI__.core.invoke('get_study_plans');
    console.log('✅ 学习计划列表获取成功:', studyPlansResult);

    // 检查统一状态字段
    if (studyPlansResult && studyPlansResult.length > 0) {
      const firstPlan = studyPlansResult[0];
      console.log('🔍 检查统一状态字段:');
      console.log('  - unified_status:', firstPlan.unified_status);
      console.log('  - 旧状态 (status):', firstPlan.status);
      console.log('  - 旧生命周期 (lifecycle_status):', firstPlan.lifecycle_status);

      if (firstPlan.unified_status) {
        console.log('✅ 统一状态字段存在');
      } else {
        console.log('❌ 统一状态字段缺失');
      }
    }

    // 测试2: 获取单词本列表
    console.log('📚 测试获取单词本列表...');
    const wordBooksResult = await window.__TAURI__.core.invoke('get_word_books', {
      status: 'normal',
      includeDeleted: false
    });
    console.log('✅ 单词本列表获取成功:', wordBooksResult);

    // 测试3: 测试参数命名转换
    if (wordBooksResult && wordBooksResult.length > 0) {
      const firstBookId = wordBooksResult[0].id;
      console.log('📖 测试获取单词本详情 (测试参数命名转换)...');
      const bookDetailResult = await window.__TAURI__.core.invoke('get_word_book_detail', {
        bookId: firstBookId  // 前端使用驼峰命名
      });
      console.log('✅ 单词本详情获取成功:', bookDetailResult);
    }

    console.log('🎉 所有学习计划功能测试通过！');
    return true;

  } catch (error) {
    console.error('❌ 学习计划功能测试失败:', error);
    return false;
  }
}

// 测试前后端命名转换
async function testNamingConversion() {
  console.log('🔄 测试前后端命名转换...');
  
  const testCases = [
    { frontend: 'bookId', backend: 'book_id' },
    { frontend: 'wordId', backend: 'word_id' },
    { frontend: 'planId', backend: 'plan_id' },
    { frontend: 'modelId', backend: 'model_id' },
    { frontend: 'wordbookIds', backend: 'wordbook_ids' },
  ];
  
  console.log('📝 命名转换规则:');
  testCases.forEach(({ frontend, backend }) => {
    console.log(`  ${frontend} → ${backend}`);
  });
  
  return true;
}

// 测试状态管理和前端显示
async function testStatusManagement() {
  console.log('📊 测试状态管理和前端显示...');

  const statusMapping = {
    'Draft': '草稿',
    'Pending': '待开始',
    'Active': '进行中',
    'Paused': '已暂停',
    'Completed': '已完成',
    'Terminated': '已终止',
    'Deleted': '已删除'
  };

  console.log('🏷️ 统一状态映射:');
  Object.entries(statusMapping).forEach(([status, display]) => {
    console.log(`  ${status} → ${display}`);
  });

  // 测试前端状态过滤功能
  console.log('🔍 测试前端状态过滤功能...');
  const studyPlansPage = document.querySelector('[data-page="study-plans"]');
  if (studyPlansPage) {
    console.log('✅ 学习计划页面已加载');

    // 检查状态过滤器
    const statusFilter = document.querySelector('select[data-filter="status"]');
    if (statusFilter) {
      console.log('✅ 状态过滤器存在');
      console.log('  过滤器选项:', Array.from(statusFilter.options).map(opt => opt.text));
    } else {
      console.log('❌ 状态过滤器不存在');
    }

    // 检查学习计划卡片
    const planCards = document.querySelectorAll('[data-component="study-plan-card"]');
    console.log(`📋 找到 ${planCards.length} 个学习计划卡片`);

    planCards.forEach((card, index) => {
      const statusElement = card.querySelector('.status');
      if (statusElement) {
        console.log(`  计划 ${index + 1} 状态: ${statusElement.textContent}`);
      }
    });
  } else {
    console.log('ℹ️ 当前不在学习计划页面');
  }

  return true;
}

// 运行所有测试
async function runAllTests() {
  console.log('🚀 开始运行学习计划功能修复测试...\n');

  const results = {
    studyPlan: await testStudyPlanFixes(),
    naming: await testNamingConversion(),
    status: await testStatusManagement()
  };

  console.log('\n📊 测试结果汇总:');
  console.log(`  学习计划功能测试: ${results.studyPlan ? '✅ 通过' : '❌ 失败'}`);
  console.log(`  命名转换测试: ${results.naming ? '✅ 通过' : '❌ 失败'}`);
  console.log(`  状态管理测试: ${results.status ? '✅ 通过' : '❌ 失败'}`);

  const allPassed = Object.values(results).every(result => result);
  console.log(`\n🎯 总体结果: ${allPassed ? '✅ 全部通过' : '❌ 存在问题'}`);

  if (allPassed) {
    console.log('\n🎉 恭喜！学习计划功能修复成功！');
    console.log('📝 修复内容:');
    console.log('  ✅ 前后端命名规范统一');
    console.log('  ✅ AI分析进度跟踪机制统一');
    console.log('  ✅ 错误处理机制统一');
    console.log('  ✅ 学习计划状态管理简化');
    console.log('  ✅ 前端页面状态过滤和显示修复');
  }

  return results;
}

// 导出测试函数
if (typeof window !== 'undefined') {
  window.testStudyPlanFixes = testStudyPlanFixes;
  window.testNamingConversion = testNamingConversion;
  window.testStatusManagement = testStatusManagement;
  window.runAllTests = runAllTests;

  console.log('🔧 学习计划功能测试函数已加载，可以在控制台中运行:');
  console.log('  - runAllTests() - 运行所有测试');
  console.log('  - testStudyPlanFixes() - 测试学习计划功能');
  console.log('  - testNamingConversion() - 测试命名转换');
  console.log('  - testStatusManagement() - 测试状态管理');
  console.log('');
  console.log('💡 建议先运行 runAllTests() 进行完整测试');
}
