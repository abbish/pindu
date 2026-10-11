//! 短文与题组

use super::*;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PassageWordsToBookArgs {
    pub passage_id: i64,
    pub book_id: i64,
    /// Words from passage_new_words / the passage vocabulary
    pub words: Vec<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListPassagesArgs {
    /// Only passages written from this word book
    #[serde(default)]
    pub book_id: Option<i64>,
    /// generated / imported
    #[serde(default)]
    pub origin: Option<String>,
    /// Text in the title
    #[serde(default)]
    pub search: Option<String>,
}

#[tool_router(router = passages_router, vis = "pub(super)")]
impl PinduTools {
    #[tool(
        description = "List the learner's passages (id, title, level, vocabulary, question sets). Filter by word book (passages written from it), origin (generated = written by AI, imported = from the learner's material) or a search text in the title.",
        annotations(read_only_hint = true)
    )]
    async fn list_passages(
        &self,
        Parameters(args): Parameters<ListPassagesArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let origin = args
            .origin
            .as_deref()
            .filter(|o| matches!(*o, "generated" | "imported"));
        match self.passages().list(args.book_id, None, origin).await {
            Ok(list) => {
                let query = args
                    .search
                    .as_deref()
                    .map(|q| q.trim().to_lowercase())
                    .filter(|q| !q.is_empty());
                let shown: Vec<&crate::types::passage::PassageSummary> = list
                    .iter()
                    .filter(|p| {
                        query
                            .as_ref()
                            .is_none_or(|q| p.title.to_lowercase().contains(q))
                    })
                    .collect();
                let data: Vec<Value> = shown
                    .iter()
                    .map(|p| {
                        json!({ "id": p.id, "title": p.title, "level": p.level, "words": p.word_count, "origin": p.origin,
                                "questionSets": p.question_sets,
                                "vocabulary": p.target_words.iter().map(|w| w.word.clone()).collect::<Vec<_>>() })
                    })
                    .collect();
                done(json!(data), format!("看了短文库：{} 篇", shown.len()), None)
            }
            Err(e) => failed("没能查看短文库", e),
        }
    }

    #[tool(
        description = "Read one passage: sentences with Chinese translation, and its vocabulary.",
        annotations(read_only_hint = true)
    )]
    async fn get_passage(
        &self,
        Parameters(args): Parameters<PassageArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match self.passages().get(args.passage_id).await {
            Ok(p) => {
                let sentences: Vec<Value> = p
                    .sentences
                    .iter()
                    .enumerate()
                    .map(|(i, s)| json!({ "index": i, "en": s.en, "zh": s.zh }))
                    .collect();
                let vocabulary: Vec<Value> = p
                    .target_words
                    .iter()
                    .map(|w| json!({ "word": w.word, "meaning": w.meaning }))
                    .collect();
                let step = format!("读了短文《{}》", p.title);
                done(
                    json!({ "id": p.id, "title": p.title, "level": p.level, "sentences": sentences, "vocabulary": vocabulary,
                            "questionSets": p.question_sets.iter().map(|q| json!({ "id": q.id, "name": q.name, "mode": q.mode, "attempts": q.completed_attempts })).collect::<Vec<_>>(), "scene": p.scene }),
                    step,
                    None,
                )
            }
            Err(e) => failed("没能打开这篇短文", e),
        }
    }

    #[tool(
        description = "Save an English passage to the learner's library, kept exactly as given: a passage you wrote for the learner (based on everything discussed), or a text the learner shared. Give the words it is for in `vocabulary`; each must appear in the text. Translation (and a title if empty) is added in the background.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn save_passage(
        &self,
        Parameters(args): Parameters<SavePassageArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        // 词汇须出现在正文里（按词形，词组可变形）：没出现的退回给 AI 老师改
        let missing = missing_vocabulary(&args.text, &args.vocabulary);
        if !missing.is_empty() {
            return failed(
                "存短文前核对词汇",
                AppError::ValidationError(format!(
                    "这些词没有出现在正文里：{}。请改写正文让它们自然出现，或者从词汇里去掉",
                    missing.join("、")
                )),
            );
        }
        let preview_result = crate::handlers::prepare_passage_import(
            self.app.clone(),
            serde_json::from_value(json!({ "text": args.text, "targetWords": 450 }))
                .map_err(|e| ErrorData::internal_error(e.to_string(), None))?,
        )
        .await;
        let preview = match preview_result {
            Ok(p) => p,
            Err(e) => return failed("没能存成短文", e),
        };
        let title = args
            .title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(str::to_string);
        // AI 老师写的是一篇：预处理按篇幅拆开的合回一篇
        let sentences: Vec<crate::types::passage::ImportSentence> = preview
            .items
            .iter()
            .flat_map(|item| item.sentences.clone())
            .collect();
        if sentences.is_empty() {
            return failed(
                "没能存成短文",
                AppError::ValidationError("正文里没有英文句子".to_string()),
            );
        }
        let vocabulary: Vec<crate::types::passage::ImportWord> = args
            .vocabulary
            .iter()
            .filter(|w| !w.word.trim().is_empty())
            .map(|w| crate::types::passage::ImportWord {
                word: crate::types::wordbook::normalize_vocab(w.word.trim()),
                meaning: w.meaning.clone().filter(|m| !m.trim().is_empty()),
                forms: Vec::new(),
            })
            .collect();
        let items = vec![crate::types::passage::ImportPassageRequest {
            title: title.clone(),
            sentences,
            source_label: "AI 老师".to_string(),
            book_ids: args.book_ids.clone(),
            // 给了词汇就用这些；没给时让 AI 挑重点词
            ai_key_words: vocabulary.is_empty(),
            words: vocabulary,
        }];
        match crate::handlers::start_passage_import(
            self.app.clone(),
            crate::types::passage::ImportPassagesRequest { items },
        )
        .await
        {
            Ok(job) => {
                // 结束时通知这个对话（AI 老师接着说）
                crate::mcp::job_notice::track(&job, true);
                let name = title.clone().unwrap_or_else(|| "新短文".to_string());
                let step = format!("存成短文《{}》，后台在翻译", name);
                let output = json!({ "kind": "passage", "title": name, "meta": format!("约 {} 词", preview.total_words), "jobId": job });
                done(
                    json!({ "words": preview.total_words, "note": "Saved. Translation runs in the background; the passage appears in the library when it is done." }),
                    step,
                    Some(output),
                )
            }
            Err(e) => failed("没能存成短文", e),
        }
    }

    #[tool(
        description = "Generate a question set (reading comprehension or listening) for a passage in the library. Runs in the background.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn create_question_set(
        &self,
        Parameters(args): Parameters<QuestionSetArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let passage = match self.passages().get(args.passage_id).await {
            Ok(p) => p,
            Err(e) => return failed("没能打开这篇短文", e),
        };
        let mode = match args.mode.as_deref() {
            Some("listening") => "listening",
            _ => "reading",
        };
        let spec = json!({
            "cloze": args.cloze.unwrap_or(0), "choice": args.choice.unwrap_or(3),
            "trueFalse": args.true_false.unwrap_or(2), "open": args.open.unwrap_or(0),
            "difficulty": args.difficulty.clone().unwrap_or_else(|| "standard".to_string()),
        });
        let request = match serde_json::from_value(
            json!({ "passageId": args.passage_id, "mode": mode, "name": null, "spec": spec }),
        ) {
            Ok(r) => r,
            Err(e) => return Err(ErrorData::internal_error(e.to_string(), None)),
        };
        let label = if mode == "listening" {
            "听力"
        } else {
            "阅读理解"
        };
        match crate::handlers::start_question_set_generation(self.app.clone(), request).await {
            Ok(job) => {
                // 结束时通知这个对话（AI 老师接着说）
                crate::mcp::job_notice::track(&job, true);
                let output = json!({ "kind": "questions", "id": passage.id, "title": format!("{}题", label),
                                     "meta": format!("《{}》", passage.title), "jobId": job });
                done(
                    json!({ "note": "Generating in the background." }),
                    format!("开始为《{}》出{}题", passage.title, label),
                    Some(output),
                )
            }
            Err(e) => failed("没能开始出题", e),
        }
    }

    #[tool(
        description = "Change a passage's title, level (a1 / a2 / b1 / b2) or scene description. Only the fields you give are changed.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn update_passage(
        &self,
        Parameters(args): Parameters<UpdatePassageArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let request = crate::types::passage::UpdatePassageInfoRequest {
            passage_id: args.passage_id,
            title: args.title.clone().map(|t| t.trim().to_string()),
            level: args.level.as_deref().map(|l| l.trim().to_lowercase()),
            scene: args.scene.clone(),
        };
        match crate::handlers::update_passage_info(self.app.clone(), request).await {
            Ok(p) => done(
                json!({ "id": p.id, "title": p.title, "level": p.level }),
                format!("改好了短文《{}》", p.title),
                Some(json!({ "kind": "passage", "id": p.id, "title": p.title })),
            ),
            Err(e) => failed("没能修改短文", e),
        }
    }

    #[tool(
        description = "Fix the Chinese translation of one sentence of a passage (index from get_passage, 0-based).",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn update_translation(
        &self,
        Parameters(args): Parameters<TranslationArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::update_passage_translation(
            self.app.clone(),
            args.passage_id,
            args.index,
            args.zh.trim().to_string(),
        )
        .await
        {
            Ok(p) => done(
                json!({ "updated": true }),
                format!("改了《{}》第 {} 句的译文", p.title, args.index + 1),
                None,
            ),
            Err(e) => failed("没能修改译文", e),
        }
    }

    #[tool(
        description = "Change a passage's vocabulary (the words it is for): add words that appear in the text (any form), and / or remove words.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn set_passage_vocabulary(
        &self,
        Parameters(args): Parameters<PassageVocabularyArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let mut added = Vec::new();
        let mut problems = Vec::new();
        for word in args.add.iter().map(|w| w.trim()).filter(|w| !w.is_empty()) {
            match crate::handlers::add_passage_target_word(
                self.app.clone(),
                args.passage_id,
                word.to_string(),
                None,
            )
            .await
            {
                Ok(_) => added.push(word.to_string()),
                Err(e) => problems.push(format!("{}：{}", word, e.user_message())),
            }
        }
        let mut removed = Vec::new();
        for word in args
            .remove
            .iter()
            .map(|w| w.trim())
            .filter(|w| !w.is_empty())
        {
            match crate::handlers::remove_passage_target_word(
                self.app.clone(),
                args.passage_id,
                word.to_string(),
            )
            .await
            {
                Ok(_) => removed.push(word.to_string()),
                Err(e) => problems.push(format!("{}：{}", word, e.user_message())),
            }
        }
        let mut step = Vec::new();
        if !added.is_empty() {
            step.push(format!("加了 {}", preview(&added, 3)));
        }
        if !removed.is_empty() {
            step.push(format!("去掉了 {}", preview(&removed, 3)));
        }
        if step.is_empty() {
            step.push("词汇没有变化".to_string());
        }
        done(
            json!({ "added": added, "removed": removed, "problems": problems }),
            format!("改了短文的词汇：{}", step.join("，")),
            None,
        )
    }

    #[tool(
        description = "Deletes a passage with its question sets and practice records. Not allowed while an unfinished study plan uses it. The learner is asked to confirm.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn delete_passage(
        &self,
        Parameters(args): Parameters<PassageArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let title = self
            .passages()
            .get(args.passage_id)
            .await
            .map(|p| p.title)
            .unwrap_or_default();
        match crate::handlers::delete_passage(self.app.clone(), args.passage_id).await {
            Ok(()) => done(
                json!({ "deleted": true }),
                format!("删除了短文《{}》", title),
                None,
            ),
            Err(e) => failed("没能删除短文", e),
        }
    }

    #[tool(
        description = "Read a question set: questions, options, answers and explanations (to go through it with the learner).",
        annotations(read_only_hint = true)
    )]
    async fn get_question_set(
        &self,
        Parameters(args): Parameters<QuestionSetIdArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::get_question_set(self.app.clone(), args.set_id).await {
            Ok(set) => {
                let questions: Vec<Value> = set
                    .questions
                    .iter()
                    .map(|q| json!({ "kind": q.kind, "stem": q.stem, "options": q.options, "answer": q.answer,
                                     "explanation": q.explanation, "referenceAnswer": q.reference_answer }))
                    .collect();
                done(
                    json!({ "id": set.id, "name": set.name, "mode": set.mode, "questions": questions, "clozeBank": set.cloze_bank }),
                    format!("看了题组「{}」：{} 题", set.name, set.questions.len()),
                    None,
                )
            }
            Err(e) => failed("没能打开题组", e),
        }
    }

    #[tool(
        description = "Rename a question set.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn rename_question_set(
        &self,
        Parameters(args): Parameters<RenameSetArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::rename_question_set(
            self.app.clone(),
            args.set_id,
            args.name.trim().to_string(),
        )
        .await
        {
            Ok(set) => done(
                json!({ "name": set.name }),
                format!("题组改名为「{}」", set.name),
                None,
            ),
            Err(e) => failed("没能改题组名", e),
        }
    }

    #[tool(
        description = "Deletes a question set with its practice records. Not allowed while an unfinished study plan uses it. The learner is asked to confirm.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn delete_question_set(
        &self,
        Parameters(args): Parameters<QuestionSetIdArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::delete_question_set(self.app.clone(), args.set_id).await {
            Ok(()) => done(json!({ "deleted": true }), "删除了题组".to_string(), None),
            Err(e) => failed("没能删除题组", e),
        }
    }

    #[tool(
        description = "Reading / listening practice results overall: how many passages and question sets, attempts, average scores.",
        annotations(read_only_hint = true)
    )]
    async fn passage_results(&self) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::get_passage_statistics(self.app.clone(), None).await {
            Ok(stats) => done(
                serde_json::to_value(&stats).unwrap_or(Value::Null),
                "看了短文练习的成绩".to_string(),
                None,
            ),
            Err(e) => failed("没能查看短文练习成绩", e),
        }
    }

    #[tool(
        description = "Key words of a passage that are not in any word book yet (word, meaning) — candidates to collect.",
        annotations(read_only_hint = true)
    )]
    async fn passage_new_words(
        &self,
        Parameters(args): Parameters<PassageArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::get_passage_new_words(self.app.clone(), args.passage_id).await {
            Ok(words) => {
                let data: Vec<Value> = words
                    .iter()
                    .map(|w| json!({ "word": w.word, "meaning": w.meaning }))
                    .collect();
                done(
                    json!(data),
                    format!("看了短文里还没收进词汇本的词：{} 个", words.len()),
                    None,
                )
            }
            Err(e) => failed("没能查看短文的生词", e),
        }
    }

    #[tool(
        description = "Add key words of a passage to a word book (spelling analysis in the background, then they become this passage's vocabulary linked to the book).",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn add_passage_words_to_book(
        &self,
        Parameters(args): Parameters<PassageWordsToBookArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let request = crate::types::passage::AddPassageWordsRequest {
            passage_id: args.passage_id,
            book_id: args.book_id,
            words: args
                .words
                .iter()
                .map(|w| w.trim().to_string())
                .filter(|w| !w.is_empty())
                .collect(),
        };
        let count = request.words.len();
        match crate::handlers::add_passage_words_to_book(self.app.clone(), request).await {
            Ok(_) => {
                let book = self
                    .word_books()
                    .get_word_book(args.book_id)
                    .await
                    .map(|b| b.title)
                    .unwrap_or_default();
                done(
                    json!({ "added": count }),
                    format!("把短文里的 {} 个词加进了《{}》", count, book),
                    Some(
                        json!({ "kind": "words", "id": args.book_id, "title": preview(&args.words, 3), "meta": format!("加进《{}》", book) }),
                    ),
                )
            }
            Err(e) => failed("没能把这些词加进词汇本", e),
        }
    }

    #[tool(
        description = "Prepare word cards (spelling, phonetic, examples) for a passage's vocabulary that is not in any word book, so the learner can tap them while reading. Runs in the background.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn prepare_word_cards(
        &self,
        Parameters(args): Parameters<PassageArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::start_word_cards(self.app.clone(), args.passage_id).await {
            Ok(Some(job)) => {
                crate::mcp::job_notice::track(&job, false);
                done(
                    json!({ "started": true }),
                    "开始准备单词卡（后台进行）".to_string(),
                    None,
                )
            }
            Ok(None) => done(
                json!({ "started": false, "note": "All word cards are ready." }),
                "单词卡都已准备好".to_string(),
                None,
            ),
            Err(e) => failed("没能准备单词卡", e),
        }
    }
}
