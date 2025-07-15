// 临时测试文件 - 用于验证前后端API连接
import { 
  getStudyPlans, 
  getStudyStatistics, 
  getWordBooks, 
  getWordBookStatistics,
  createStudyPlan,
  createWordBook,
  getWordsByBook,
  getStudyPlanWords,
  startStudySession,
  submitWordAnswer,
  endStudySession
} from './utils/database';

// 测试API连接的函数
export async function testApiConnection() {
  try {
    console.log('🔍 测试API连接...');
    
    // 测试获取学习计划
    console.log('1. 测试获取学习计划');
    const plans = await getStudyPlans();
    console.log('✅ 学习计划:', plans);
    
    // 测试获取统计信息
    console.log('2. 测试获取统计信息');
    const stats = await getStudyStatistics();
    console.log('✅ 统计信息:', stats);
    
    // 测试获取单词本
    console.log('3. 测试获取单词本');
    const books = await getWordBooks();
    console.log('✅ 单词本:', books);
    
    // 测试获取单词本统计
    console.log('4. 测试获取单词本统计');
    const bookStats = await getWordBookStatistics();
    console.log('✅ 单词本统计:', bookStats);
    
    // 测试获取单词
    if (books.length > 0) {
      console.log('5. 测试获取单词');
      const words = await getWordsByBook(books[0].id);
      console.log('✅ 单词列表:', words);
    }
    
    // 测试创建学习计划
    console.log('6. 测试创建学习计划');
    const newPlanId = await createStudyPlan({
      name: '测试计划',
      description: '这是一个测试计划',
      word_ids: ['1', '2']
    });
    console.log('✅ 新建计划ID:', newPlanId);
    
    // 测试创建单词本
    console.log('7. 测试创建单词本');
    const newBookId = await createWordBook({
      title: '测试单词本',
      description: '这是一个测试单词本',
      icon: 'book',
      icon_color: 'blue'
    });
    console.log('✅ 新建单词本ID:', newBookId);
    
    // 测试学习会话
    if (plans.length > 0) {
      console.log('8. 测试开始学习会话');
      const sessionId = await startStudySession(plans[0].plan.id);
      console.log('✅ 会话ID:', sessionId);
      
      console.log('9. 测试提交答案');
      await submitWordAnswer(sessionId, '1', 'apple', true, 5000);
      console.log('✅ 答案已提交');
      
      console.log('10. 测试结束会话');
      await endStudySession(sessionId, 1, 1, 5000);
      console.log('✅ 会话已结束');
    }
    
    console.log('🎉 所有API测试完成！');
    return true;
    
  } catch (error) {
    console.error('❌ API测试失败:', error);
    return false;
  }
}

// 在开发环境中自动运行测试
if (import.meta.env.DEV) {
  // 延迟执行，等待Tauri初始化
  setTimeout(() => {
    testApiConnection();
  }, 2000);
}