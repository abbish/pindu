// 测试日历数据的脚本
// 在浏览器控制台中运行此脚本来检查日历数据

async function testCalendarData() {
  console.log('🗓️ 开始测试日历数据...');

  try {
    // 测试当前月份的日历数据
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    
    console.log(`📅 获取 ${year}年${month}月 的日历数据...`);
    
    const calendarResult = await window.__TAURI__.core.invoke('get_calendar_month_data', {
      year: year,
      month: month,
      includeOtherMonths: true
    });
    
    console.log('✅ 日历数据获取成功:', calendarResult);
    
    // 分析数据
    if (calendarResult && calendarResult.days) {
      console.log(`📊 日历数据分析:`);
      console.log(`  - 总天数: ${calendarResult.days.length}`);
      
      const daysWithPlans = calendarResult.days.filter(day => day.isInPlan);
      console.log(`  - 有计划的天数: ${daysWithPlans.length}`);
      
      if (daysWithPlans.length > 0) {
        console.log(`  - 有计划的日期:`, daysWithPlans.map(day => day.date));
        
        daysWithPlans.forEach(day => {
          console.log(`    ${day.date}: 新学${day.newWordsCount}词, 复习${day.reviewWordsCount}词, 状态: ${day.status}`);
          if (day.studyPlans) {
            day.studyPlans.forEach(plan => {
              console.log(`      计划: ${plan.name} (${plan.targetWords}词)`);
            });
          }
        });
      } else {
        console.log('❌ 没有找到任何学习计划日程');
      }
      
      // 检查月度统计
      if (calendarResult.monthlyStats) {
        console.log(`📈 月度统计:`);
        console.log(`  - 学习天数: ${calendarResult.monthlyStats.studyDays}`);
        console.log(`  - 完成天数: ${calendarResult.monthlyStats.completedDays}`);
        console.log(`  - 总学习单词: ${calendarResult.monthlyStats.totalWordsLearned}`);
        console.log(`  - 活跃计划数: ${calendarResult.monthlyStats.activePlansCount}`);
      }
    }
    
    // 测试8月份数据
    console.log(`📅 获取 2024年8月 的日历数据...`);
    const augustResult = await window.__TAURI__.core.invoke('get_calendar_month_data', {
      year: 2024,
      month: 8,
      includeOtherMonths: true
    });
    
    console.log('✅ 8月日历数据获取成功:', augustResult);
    
    if (augustResult && augustResult.days) {
      const augustDaysWithPlans = augustResult.days.filter(day => day.isInPlan);
      console.log(`📊 8月数据分析:`);
      console.log(`  - 有计划的天数: ${augustDaysWithPlans.length}`);
      
      if (augustDaysWithPlans.length > 0) {
        console.log(`  - 有计划的日期:`, augustDaysWithPlans.map(day => day.date));
      } else {
        console.log('❌ 8月没有找到任何学习计划日程');
      }
    }
    
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

// 测试学习计划数据
async function testStudyPlans() {
  console.log('📋 检查学习计划数据...');
  
  try {
    const plansResult = await window.__TAURI__.core.invoke('get_study_plans');
    console.log('✅ 学习计划数据:', plansResult);
    
    if (plansResult && plansResult.length > 0) {
      for (const plan of plansResult) {
        console.log(`📝 计划: ${plan.name}`);
        console.log(`  - ID: ${plan.id}`);
        console.log(`  - 状态: ${plan.status}`);
        console.log(`  - 生命周期: ${plan.lifecycle_status}`);
        console.log(`  - 开始日期: ${plan.start_date}`);
        console.log(`  - 结束日期: ${plan.end_date}`);
        
        // 检查是否有AI计划数据
        if (plan.ai_plan_data) {
          try {
            const aiData = JSON.parse(plan.ai_plan_data);
            console.log(`  - AI计划数据存在, 日程数: ${aiData.daily_plans ? aiData.daily_plans.length : 0}`);
            if (aiData.daily_plans && aiData.daily_plans.length > 0) {
              console.log(`  - 日程范围: ${aiData.daily_plans[0].date} 到 ${aiData.daily_plans[aiData.daily_plans.length - 1].date}`);
            }
          } catch (e) {
            console.log(`  - AI计划数据解析失败:`, e);
          }
        } else {
          console.log(`  - 没有AI计划数据`);
        }
      }
    } else {
      console.log('❌ 没有找到任何学习计划');
    }
  } catch (error) {
    console.error('❌ 获取学习计划失败:', error);
  }
}

// 诊断日历数据状态
async function diagnoseCalendarData() {
  console.log('🔍 开始诊断日历数据状态...');

  try {
    const diagnosis = await window.__TAURI__.core.invoke('diagnose_calendar_data');
    console.log('✅ 诊断完成:', diagnosis);

    // 分析诊断结果
    if (diagnosis.study_plans && diagnosis.study_plans.length > 0) {
      console.log(`📊 学习计划分析:`);
      diagnosis.study_plans.forEach(plan => {
        console.log(`  计划: ${plan.name} (ID: ${plan.id})`);
        console.log(`    - 生命周期状态: ${plan.lifecycle_status}`);
        console.log(`    - 开始日期: ${plan.start_date || '未设置'}`);
        console.log(`    - 结束日期: ${plan.end_date || '未设置'}`);
        console.log(`    - 有AI数据: ${plan.has_ai_data ? '是' : '否'}`);
        console.log(`    - 日程数量: ${plan.schedule_count}`);

        if (!plan.has_ai_data) {
          console.log(`    ⚠️  该计划没有AI规划数据，无法在日历中显示`);
        }
        if (plan.schedule_count === 0) {
          console.log(`    ⚠️  该计划没有日程安排，无法在日历中显示`);
        }
      });
    } else {
      console.log('❌ 没有找到任何学习计划');
    }

    console.log(`📈 总日程数量: ${diagnosis.total_schedules}`);

    if (diagnosis.schedule_date_range) {
      console.log(`📅 日程日期范围: ${diagnosis.schedule_date_range.min_date} 到 ${diagnosis.schedule_date_range.max_date}`);
    }

    // 给出建议
    if (diagnosis.total_schedules === 0) {
      console.log('💡 建议: 当前没有任何学习计划日程数据。请：');
      console.log('   1. 使用新版本创建计划页面创建带AI规划的学习计划');
      console.log('   2. 或者为现有计划重新生成AI规划');
    }

  } catch (error) {
    console.error('❌ 诊断失败:', error);
  }
}

// 运行所有测试
async function runAllTests() {
  await diagnoseCalendarData();
  await testStudyPlans();
  await testCalendarData();
}

// 导出函数供控制台使用
window.testCalendarData = testCalendarData;
window.testStudyPlans = testStudyPlans;
window.diagnoseCalendarData = diagnoseCalendarData;
window.runAllTests = runAllTests;

console.log('🧪 日历数据测试脚本已加载');
console.log('运行 runAllTests() 来执行所有测试');
console.log('运行 diagnoseCalendarData() 来诊断日历数据状态');
console.log('运行 testCalendarData() 来测试日历数据');
console.log('运行 testStudyPlans() 来测试学习计划数据');
