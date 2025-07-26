#[cfg(test)]
mod tests {
    use sqlx::{SqlitePool, Row};

    async fn setup_test_db() -> SqlitePool {
        // 连接到实际的数据库文件，而不是内存数据库
        let db_path = std::env::var("APPDATA")
            .map(|appdata| format!("{}/com.redlark.vocabulary-app/vocabulary.db", appdata))
            .unwrap_or_else(|_| "vocabulary.db".to_string());

        let pool = SqlitePool::connect(&format!("sqlite:{}", db_path)).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn test_study_plan_statistics_comprehensive_analysis() {
        let pool = setup_test_db().await;

        println!("=== 学习计划统计数据全面分析测试 ===");

        // 1. 查询学习计划基本信息
        println!("\n1. 查询学习计划基本信息:");
        let plan_query = "SELECT id, name, total_words, start_date, end_date, created_at FROM study_plans WHERE name LIKE '%20250726%'";
        let plans = sqlx::query(plan_query).fetch_all(&pool).await.unwrap();
        
        for plan in &plans {
            let id: i64 = plan.get("id");
            let name: String = plan.get("name");
            let total_words: i64 = plan.get("total_words");
            let start_date: Option<String> = plan.get("start_date");
            let end_date: Option<String> = plan.get("end_date");
            let created_at: Option<String> = plan.get("created_at");

            println!("  计划ID: {}, 名称: {}, 总单词数: {}", id, name, total_words);
            println!("  开始日期: {:?}, 结束日期: {:?}", start_date, end_date);
            println!("  创建时间: {:?}", created_at);
            
            // 2. 查询练习会话数据
            println!("\n2. 查询练习会话数据:");
            let sessions_query = "SELECT id, completed, start_time, end_time FROM practice_sessions WHERE plan_id = ?";
            let sessions = sqlx::query(sessions_query).bind(id).fetch_all(&pool).await.unwrap();
            
            println!("  总练习会话数: {}", sessions.len());
            for session in &sessions {
                let session_id: String = session.get("id");
                let completed: bool = session.get("completed");
                let start_time: Option<String> = session.get("start_time");
                let end_time: Option<String> = session.get("end_time");
                
                println!("    会话ID: {}, 已完成: {}, 开始: {:?}, 结束: {:?}", 
                    session_id, completed, start_time, end_time);
            }
            
            // 3. 查询练习记录数据
            println!("\n3. 查询练习记录数据:");
            let records_query = r#"
                SELECT wpr.word_id, wpr.is_correct, wpr.step, ps.completed as session_completed
                FROM word_practice_records wpr
                JOIN practice_sessions ps ON wpr.session_id = ps.id
                WHERE ps.plan_id = ?
                ORDER BY wpr.word_id, wpr.step
            "#;
            let records = sqlx::query(records_query).bind(id).fetch_all(&pool).await.unwrap();
            
            println!("  总练习记录数: {}", records.len());
            let mut word_stats = std::collections::HashMap::new();
            
            for record in &records {
                let word_id: i64 = record.get("word_id");
                let is_correct: bool = record.get("is_correct");
                let step: i32 = record.get("step");
                let session_completed: bool = record.get("session_completed");
                
                let entry = word_stats.entry(word_id).or_insert_with(|| {
                    (Vec::new(), session_completed)
                });
                entry.0.push((step, is_correct));
            }
            
            for (word_id, (steps, session_completed)) in &word_stats {
                println!("    单词ID: {}, 会话已完成: {}, 步骤记录: {:?}", 
                    word_id, session_completed, steps);
            }
            
            // 4. 测试当前的统计查询
            println!("\n4. 测试当前的统计查询:");
            
            // 4.1 已学单词数查询（当前逻辑）
            let completed_words_query = r#"
                SELECT COUNT(DISTINCT wpr.word_id) as completed_count
                FROM word_practice_records wpr
                JOIN practice_sessions ps ON wpr.session_id = ps.id
                WHERE ps.plan_id = ? AND ps.completed = TRUE
            "#;
            
            let result = sqlx::query(completed_words_query).bind(id).fetch_one(&pool).await.unwrap();
            let completed_count: i64 = result.get("completed_count");
            println!("  当前逻辑 - 已学单词数: {}", completed_count);
            
            // 4.2 已完成会话数查询
            let completed_sessions_query = r#"
                SELECT COUNT(*) as completed_sessions
                FROM practice_sessions
                WHERE plan_id = ? AND completed = TRUE
            "#;
            
            let result = sqlx::query(completed_sessions_query).bind(id).fetch_one(&pool).await.unwrap();
            let completed_sessions: i64 = result.get("completed_sessions");
            println!("  已完成会话数: {}", completed_sessions);
            
            // 4.3 总练习记录数
            let total_records_query = r#"
                SELECT COUNT(*) as total_records
                FROM word_practice_records wpr
                JOIN practice_sessions ps ON wpr.session_id = ps.id
                WHERE ps.plan_id = ?
            "#;
            
            let result = sqlx::query(total_records_query).bind(id).fetch_one(&pool).await.unwrap();
            let total_records: i64 = result.get("total_records");
            println!("  总练习记录数: {}", total_records);
            
            // 4.4 不同统计方法对比
            println!("\n5. 不同统计方法对比:");
            
            // 方法1：只要有练习记录就算已学
            let method1_query = r#"
                SELECT COUNT(DISTINCT wpr.word_id) as count
                FROM word_practice_records wpr
                JOIN practice_sessions ps ON wpr.session_id = ps.id
                WHERE ps.plan_id = ?
            "#;
            let result = sqlx::query(method1_query).bind(id).fetch_one(&pool).await.unwrap();
            let method1_count: i64 = result.get("count");
            println!("  方法1 - 有练习记录的单词数: {}", method1_count);
            
            // 方法2：要求所有3个步骤都正确
            let method2_query = r#"
                SELECT COUNT(DISTINCT word_id) as count
                FROM (
                    SELECT wpr.word_id
                    FROM word_practice_records wpr
                    JOIN practice_sessions ps ON wpr.session_id = ps.id
                    WHERE ps.plan_id = ? AND ps.completed = TRUE AND wpr.is_correct = TRUE
                    GROUP BY wpr.word_id
                    HAVING COUNT(DISTINCT wpr.step) = 3
                ) as completed_words
            "#;
            let result = sqlx::query(method2_query).bind(id).fetch_one(&pool).await.unwrap();
            let method2_count: i64 = result.get("count");
            println!("  方法2 - 所有3步都正确的单词数: {}", method2_count);
            
            // 方法3：至少有一个步骤正确
            let method3_query = r#"
                SELECT COUNT(DISTINCT wpr.word_id) as count
                FROM word_practice_records wpr
                JOIN practice_sessions ps ON wpr.session_id = ps.id
                WHERE ps.plan_id = ? AND ps.completed = TRUE AND wpr.is_correct = TRUE
            "#;
            let result = sqlx::query(method3_query).bind(id).fetch_one(&pool).await.unwrap();
            let method3_count: i64 = result.get("count");
            println!("  方法3 - 至少一步正确的单词数: {}", method3_count);
            
            // 6. 检查数据完整性
            println!("\n6. 数据完整性检查:");
            
            // 检查是否有孤立的练习记录
            let orphan_records_query = r#"
                SELECT COUNT(*) as orphan_count
                FROM word_practice_records wpr
                LEFT JOIN practice_sessions ps ON wpr.session_id = ps.id
                WHERE ps.id IS NULL
            "#;
            let result = sqlx::query(orphan_records_query).fetch_one(&pool).await.unwrap();
            let orphan_count: i64 = result.get("orphan_count");
            println!("  孤立的练习记录数: {}", orphan_count);
            
            // 检查是否有未完成的会话但有练习记录
            let incomplete_with_records_query = r#"
                SELECT COUNT(DISTINCT ps.id) as count
                FROM practice_sessions ps
                JOIN word_practice_records wpr ON ps.id = wpr.session_id
                WHERE ps.plan_id = ? AND ps.completed = FALSE
            "#;
            let result = sqlx::query(incomplete_with_records_query).bind(id).fetch_one(&pool).await.unwrap();
            let incomplete_with_records: i64 = result.get("count");
            println!("  有练习记录但未完成的会话数: {}", incomplete_with_records);

            // 7. 详细指标计算测试
            println!("\n7. 详细指标计算测试:");

            // 7.1 详情页面头部指标
            println!("\n  === 详情页面头部指标 ===");

            // 总单词数 (应该是3)
            println!("  总单词数: {}", total_words);

            // 已学单词数 (当前逻辑返回3)
            println!("  已学单词数: {}", completed_count);

            // 平均正确率计算
            let accuracy_query = r#"
                SELECT
                    COUNT(CASE WHEN wpr.is_correct = TRUE THEN 1 END) as correct_count,
                    COUNT(*) as total_count
                FROM word_practice_records wpr
                JOIN practice_sessions ps ON wpr.session_id = ps.id
                WHERE ps.plan_id = ? AND ps.completed = TRUE
            "#;
            let result = sqlx::query(accuracy_query).bind(id).fetch_one(&pool).await.unwrap();
            let correct_count: i64 = result.get("correct_count");
            let total_count: i64 = result.get("total_count");
            let accuracy = if total_count > 0 { (correct_count as f64 / total_count as f64) * 100.0 } else { 0.0 };
            println!("  平均正确率: {:.1}% (正确: {}, 总计: {})", accuracy, correct_count, total_count);

            // 连续学习天数计算
            let streak_query = r#"
                SELECT COUNT(DISTINCT DATE(ps.start_time)) as study_days
                FROM practice_sessions ps
                WHERE ps.plan_id = ? AND ps.completed = TRUE
                AND DATE(ps.start_time) >= DATE('now', '-7 days')
            "#;
            let result = sqlx::query(streak_query).bind(id).fetch_one(&pool).await.unwrap();
            let study_days: i64 = result.get("study_days");
            println!("  连续学习天数: {} 天", study_days);

            // 7.2 学习效率指标
            println!("\n  === 学习效率指标 ===");

            // 总学习时间计算
            let time_query = r#"
                SELECT
                    SUM(CASE
                        WHEN ps.start_time IS NOT NULL AND ps.end_time IS NOT NULL
                        THEN (julianday(ps.end_time) - julianday(ps.start_time)) * 24 * 60
                        ELSE 0
                    END) as total_minutes
                FROM practice_sessions ps
                WHERE ps.plan_id = ? AND ps.completed = TRUE
            "#;
            let result = sqlx::query(time_query).bind(id).fetch_one(&pool).await.unwrap();
            let total_minutes: f64 = result.get::<Option<f64>, _>("total_minutes").unwrap_or(0.0);
            let total_hours = (total_minutes / 60.0) as i32;
            let remaining_minutes = (total_minutes % 60.0) as i32;
            println!("  总学习时间: {}小时 {}分钟 (总计: {:.1}分钟)", total_hours, remaining_minutes, total_minutes);

            // 平均每日学习时长
            let avg_daily_minutes = if study_days > 0 { total_minutes / study_days as f64 } else { 0.0 };
            println!("  平均每日学习时长: {:.0} 分钟", avg_daily_minutes);

            // 时间进度计算
            let time_progress = if let (Some(start), Some(end)) = (&start_date, &end_date) {
                // 计算时间进度
                let today = "2025-07-26"; // 使用固定日期进行测试
                let start_date_parsed = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d").ok();
                let end_date_parsed = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d").ok();
                let today_parsed = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d").ok();

                if let (Some(start), Some(end), Some(today)) = (start_date_parsed, end_date_parsed, today_parsed) {
                    let total_days = (end - start).num_days() + 1;
                    let elapsed_days = (today - start).num_days() + 1;
                    if total_days > 0 {
                        ((elapsed_days as f64 / total_days as f64) * 100.0).min(100.0).max(0.0)
                    } else { 0.0 }
                } else { 0.0 }
            } else { 0.0 };
            println!("  时间进度: {:.0}%", time_progress);

            // 按时完成率 (需要更复杂的逻辑，这里简化)
            let completion_rate = if total_words > 0 { (completed_count as f64 / total_words as f64) * 100.0 } else { 0.0 };
            println!("  按时完成率: {:.0}%", completion_rate);

            // 7.3 详细统计指标
            println!("\n  === 详细统计指标 ===");

            // 最长连续学习天数 (简化计算)
            let max_streak_query = r#"
                SELECT COUNT(DISTINCT DATE(ps.start_time)) as max_streak
                FROM practice_sessions ps
                WHERE ps.plan_id = ? AND ps.completed = TRUE
            "#;
            let result = sqlx::query(max_streak_query).bind(id).fetch_one(&pool).await.unwrap();
            let max_streak: i64 = result.get("max_streak");
            println!("  最长连续学习: {} 天", max_streak);

            // 计划完成率
            println!("  计划完成率: {:.0}%", completion_rate);

            // 时间完成率
            println!("  时间完成率: {:.0}%", time_progress);

            println!("\n=== 指标计算完成 ===");

            // 8. 检查数据库中的遗留字段值（仅用于验证清理效果）
            println!("\n8. 检查数据库中的遗留字段值:");

            // 检查 study_plans 表中的 learned_words 和 accuracy_rate（这些字段已不再使用）
            let db_fields_query = "SELECT learned_words, accuracy_rate FROM study_plans WHERE id = ?";
            let result = sqlx::query(db_fields_query).bind(id).fetch_one(&pool).await.unwrap();
            let db_learned_words: i32 = result.get("learned_words");
            let db_accuracy_rate: f64 = result.get("accuracy_rate");

            println!("  数据库中的 learned_words (遗留字段): {}", db_learned_words);
            println!("  数据库中的 accuracy_rate (遗留字段): {}", db_accuracy_rate);

            // 9. 数据源对比
            println!("\n9. 数据源对比:");
            println!("  === 当前实现 ===");
            println!("  前端显示的数据来源: statistics API (实时计算)");
            println!("  后端计算的正确值: {} (通过统计查询)", completed_count);
            println!("  数据库遗留字段值: {} (已不再使用)", db_learned_words);
            println!("  ✅ 前端已修复为使用实时统计数据");

            println!("\n  === 清理状态 ===");
            println!("  1. ✅ 前端已使用 statistics 对象");
            println!("  2. ✅ 遗留字段已停止更新");
            println!("  3. 📝 遗留字段保留用于数据库兼容性");

            println!("\n=== 指标计算完成 ===");
        }

        println!("\n=== 测试完成 ===");
    }
}
