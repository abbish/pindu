//! 词汇本与单词

use super::*;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct OptionalBookArgs {
    /// One word book; empty = all
    #[serde(default)]
    pub book_id: Option<i64>,
}

#[tool_router(router = words_router, vis = "pub(super)")]
impl PinduTools {
    #[tool(
        description = "List the learner's word books (词汇本) with id, title, scene description and word count.",
        annotations(read_only_hint = true)
    )]
    async fn list_word_books(&self) -> Result<CallToolResult, ErrorData> {
        match self.word_books().get_word_books(false, None).await {
            Ok(books) => {
                let data: Vec<Value> = books
                    .iter()
                    .map(|b| {
                        json!({ "id": b.id, "title": b.title, "description": b.description,
                                "words": b.total_words, "draft": b.status == "draft" })
                    })
                    .collect();
                let step = format!("看了你的词汇本：共 {} 本", books.len());
                done(json!(data), step, None)
            }
            Err(e) => failed("没能查看词汇本", e),
        }
    }

    #[tool(
        description = "Get the words of one word book (id, word, meaning, part of speech, phonetic), 100 per page; `search` filters by word or meaning.",
        annotations(read_only_hint = true)
    )]
    async fn get_word_book(
        &self,
        Parameters(args): Parameters<BookWordsArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let book = match self.word_books().get_word_book(args.book_id).await {
            Ok(b) => b,
            Err(e) => return failed("没能打开这个词汇本", e),
        };
        let page = crate::handlers::get_words_by_book(
            self.app.clone(),
            args.book_id,
            Some(args.page.unwrap_or(1).max(1)),
            Some(100),
            args.search.clone().filter(|s| !s.trim().is_empty()),
            None,
            None,
            None,
        )
        .await;
        match page {
            Ok(page) => {
                let words: Vec<Value> = page
                    .data
                    .iter()
                    .map(|w| {
                        json!({ "id": w.id, "word": w.word, "meaning": w.meaning, "pos": w.pos_abbreviation,
                                "ipa": w.ipa, "phrase": w.kind == "phrase" })
                    })
                    .collect();
                let step = match &args.search {
                    Some(q) if !q.trim().is_empty() => format!(
                        "在《{}》里找「{}」：{} 个",
                        book.title,
                        q.trim(),
                        page.total
                    ),
                    _ => format!("看了《{}》里的词：共 {} 个", book.title, page.total),
                };
                done(
                    json!({ "id": book.id, "title": book.title, "description": book.description, "status": book.status,
                            "total": page.total, "page": page.page, "totalPages": page.total_pages, "words": words }),
                    step,
                    None,
                )
            }
            Err(e) => failed("没能打开这个词汇本", e),
        }
    }

    #[tool(
        description = "Look up words in the learner's own word books: which books contain them, the saved meaning, and how well the learner knows each (memory level 0-5, wrong answers). Use before explaining a word or suggesting what to review.",
        annotations(read_only_hint = true)
    )]
    async fn lookup_words(
        &self,
        Parameters(args): Parameters<LookupWordsArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let words = clean_words(&args.words);
        match tutor_repository::lookup_words(&self.pool(), &words).await {
            Ok(rows) => {
                let found: std::collections::HashSet<String> =
                    rows.iter().map(|r| r.word.to_lowercase()).collect();
                let missing: Vec<&String> = words
                    .iter()
                    .filter(|w| !found.contains(&w.to_lowercase()))
                    .collect();
                let data: Vec<Value> = rows
                    .iter()
                    .map(|r| {
                        json!({ "word": r.word, "meaning": r.meaning, "ipa": r.ipa, "book": r.book_title,
                                "bookId": r.book_id, "memoryLevel": r.srs_box, "wrongAnswers": r.wrong,
                                "answers": r.attempts })
                    })
                    .collect();
                let step = if rows.is_empty() {
                    format!("查了你的词汇本：没有{}", preview(&words, 3))
                } else if missing.is_empty() {
                    format!("查了你的词汇本：找到{}", preview(&words, 3))
                } else {
                    format!(
                        "查了你的词汇本：{} 个在本里，{} 个还没有",
                        words.len() - missing.len(),
                        missing.len()
                    )
                };
                done(json!({ "found": data, "notInBooks": missing }), step, None)
            }
            Err(e) => failed("没能查词汇本", e),
        }
    }

    #[tool(
        description = "Create a new word book with the given words. Spelling analysis and example sentences are added in the background. Use when the learner wants to collect words into a new book.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn create_word_book(
        &self,
        Parameters(args): Parameters<CreateWordBookArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let title = args.title.trim().to_string();
        let book_id = match crate::handlers::create_word_book(
            self.app.clone(),
            crate::types::wordbook::CreateWordBookRequest {
                title: title.clone(),
                description: args.description.clone().unwrap_or_default(),
                icon: "book".to_string(),
                icon_color: "blue".to_string(),
                tag_ids: None,
            },
        )
        .await
        {
            Ok(id) => id,
            Err(e) => return failed("没能新建词汇本", e),
        };
        match self.add_to_book(book_id, &args.words).await {
            Ok((added, _, job)) => {
                let step = format!("新建词汇本《{}》，收进 {} 个词", title, added.len());
                let output = json!({ "kind": "wordbook", "id": book_id, "title": title,
                                     "meta": format!("{} 个词", added.len()), "jobId": job });
                done(
                    json!({ "bookId": book_id, "added": added, "note": "Words appear in the book after the background analysis finishes." }),
                    step,
                    Some(output),
                )
            }
            Err(e) => {
                let output = json!({ "kind": "wordbook", "id": book_id, "title": title, "meta": "还没有词" });
                let message = e.user_message();
                done(
                    json!({ "bookId": book_id, "added": [], "error": message }),
                    format!("新建了词汇本《{}》，但没能加词：{}", title, message),
                    Some(output),
                )
            }
        }
    }

    #[tool(
        description = "Add words to an existing word book (words already in the book are skipped). Spelling analysis and examples are added in the background.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn add_words(
        &self,
        Parameters(args): Parameters<AddWordsArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let book = match self.word_books().get_word_book(args.book_id).await {
            Ok(b) => b,
            Err(e) => return failed("没能打开这个词汇本", e),
        };
        match self.add_to_book(args.book_id, &args.words).await {
            Ok((added, skipped, job)) => {
                let mut step = if added.is_empty() {
                    format!("这些词《{}》里都有了", book.title)
                } else {
                    format!("把 {} 加进了《{}》", preview(&added, 3), book.title)
                };
                if !added.is_empty() && !skipped.is_empty() {
                    step.push_str(&format!("（{} 个本里已有）", skipped.len()));
                }
                let output = (!added.is_empty()).then(|| {
                    json!({ "kind": "words", "id": args.book_id, "title": preview(&added, 3),
                            "meta": format!("加进《{}》", book.title), "jobId": job })
                });
                done(
                    json!({ "added": added, "alreadyInBook": skipped }),
                    step,
                    output,
                )
            }
            Err(e) => failed("没能加词", e),
        }
    }

    #[tool(
        description = "Change a word book: title, scene description, tags (names, replaces all), or draft / normal status (drafts cannot be used in study plans). Only the fields you give are changed.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn update_word_book(
        &self,
        Parameters(args): Parameters<UpdateBookArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let tag_ids = match &args.tags {
            Some(names) => match self.tag_ids(names).await {
                Ok(ids) => Some(ids),
                Err(e) => return failed("没能改标签", e),
            },
            None => None,
        };
        let status = match args.draft {
            Some(true) => Some("draft".to_string()),
            Some(false) => Some("normal".to_string()),
            None => None,
        };
        let request = crate::types::wordbook::UpdateWordBookRequest {
            title: args.title.clone().map(|t| t.trim().to_string()),
            description: args.description.clone(),
            icon: None,
            icon_color: None,
            status,
            tag_ids,
        };
        match crate::handlers::update_word_book(self.app.clone(), args.book_id, request).await {
            Ok(()) => {
                let book = self.word_books().get_word_book(args.book_id).await.ok();
                let title = book.as_ref().map(|b| b.title.clone()).unwrap_or_default();
                done(
                    json!({ "updated": true }),
                    format!("改好了词汇本《{}》", title),
                    Some(json!({ "kind": "wordbook", "id": args.book_id, "title": title })),
                )
            }
            Err(e) => failed("没能修改词汇本", e),
        }
    }

    #[tool(
        description = "Deletes a word book (it goes to the deleted list and can be restored). Not allowed while a study plan still uses it. The learner is asked to confirm.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn delete_word_book(
        &self,
        Parameters(args): Parameters<BookArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let title = self
            .word_books()
            .get_word_book(args.book_id)
            .await
            .map(|b| b.title)
            .unwrap_or_default();
        match crate::handlers::delete_word_book(self.app.clone(), args.book_id).await {
            Ok(()) => done(
                json!({ "deleted": true, "canRestore": true }),
                format!("删除了词汇本《{}》（可以恢复）", title),
                None,
            ),
            Err(e) => failed("没能删除词汇本", e),
        }
    }

    #[tool(
        description = "Restore a deleted word book.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn restore_word_book(
        &self,
        Parameters(args): Parameters<BookArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::restore_word_book(self.app.clone(), args.book_id).await {
            Ok(()) => {
                let title = self
                    .word_books()
                    .get_word_book(args.book_id)
                    .await
                    .map(|b| b.title)
                    .unwrap_or_default();
                done(
                    json!({ "restored": true }),
                    format!("恢复了词汇本《{}》", title),
                    Some(json!({ "kind": "wordbook", "id": args.book_id, "title": title })),
                )
            }
            Err(e) => failed("没能恢复词汇本", e),
        }
    }

    #[tool(
        description = "Change one word in a word book: its meaning (Chinese), part of speech, or spelling. Get the word id from get_word_book. Only the fields you give are changed.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn update_word(
        &self,
        Parameters(args): Parameters<UpdateWordArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let request = crate::types::wordbook::UpdateWordRequest {
            word: args.word.as_deref().map(|w| w.trim().to_string()),
            meaning: args.meaning.as_deref().map(|m| m.trim().to_string()),
            part_of_speech: args.part_of_speech.clone(),
            ..Default::default()
        };
        match crate::handlers::update_word(self.app.clone(), args.word_id, request).await {
            Ok(()) => done(json!({ "updated": true }), "改好了这个词".to_string(), None),
            Err(e) => failed("没能修改这个词", e),
        }
    }

    #[tool(
        description = "Deletes words from a word book (they are also removed from study plans). Get word ids from get_word_book. The learner is asked to confirm.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn delete_words(
        &self,
        Parameters(args): Parameters<DeleteWordsArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::delete_words(self.app.clone(), args.book_id, args.word_ids.clone())
            .await
        {
            Ok(n) => done(json!({ "deleted": n }), format!("删除了 {} 个词", n), None),
            Err(e) => failed("没能删除这些词", e),
        }
    }

    #[tool(
        description = "Let the app's example writer generate more example sentences for a word (mode \"append\") or rewrite them (\"replace\"). It does not know this conversation; when the learner wants examples about something you discussed, write them yourself and use save_examples instead.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn refresh_examples(
        &self,
        Parameters(args): Parameters<ExamplesArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let mode = if args.mode.as_deref() == Some("replace") {
            "replace"
        } else {
            "append"
        };
        match crate::handlers::generate_word_examples(
            self.app.clone(),
            args.word_id,
            mode.to_string(),
            None,
        )
        .await
        {
            Ok(examples) => {
                let list: Vec<Value> = examples
                    .iter()
                    .map(|e| json!({ "en": e.sentence, "zh": e.translation }))
                    .collect();
                done(
                    json!({ "examples": list }),
                    if mode == "replace" {
                        "重新写了例句".to_string()
                    } else {
                        "补充了例句".to_string()
                    },
                    None,
                )
            }
            Err(e) => failed("没能生成例句", e),
        }
    }

    #[tool(
        description = "Where a word appears in the learner's passages and scene clips (title, level, whether it is a key word there).",
        annotations(read_only_hint = true)
    )]
    async fn word_materials(
        &self,
        Parameters(args): Parameters<WordArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match crate::handlers::get_word_materials(
            self.app.clone(),
            args.word.trim().to_string(),
            None,
        )
        .await
        {
            Ok(list) => {
                let data: Vec<Value> = list
                    .iter()
                    .map(|m| json!({ "passageId": m.passage_id, "title": m.title, "level": m.level, "keyWord": m.key }))
                    .collect();
                done(
                    json!(data),
                    format!(
                        "查了「{}」出现在哪些短文里：{} 篇",
                        args.word.trim(),
                        list.len()
                    ),
                    None,
                )
            }
            Err(e) => failed("没能查这个词出现在哪", e),
        }
    }

    #[tool(
        description = "Save example sentences you wrote for a word (use what you and the learner discussed: the scene, level, a grammar point). Each sentence must use the word (any form) and have a Chinese translation. mode \"append\" (default) adds them, \"replace\" replaces all examples.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn save_examples(
        &self,
        Parameters(args): Parameters<SaveExamplesArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        use crate::agent::tasks::ExampleMode;
        use crate::services::word_examples::WordExampleService;
        let mode = if args.mode.as_deref() == Some("replace") {
            ExampleMode::Replace
        } else {
            ExampleMode::Append
        };
        let given = args
            .examples
            .iter()
            .map(|e| crate::types::wordbook::WordExample {
                sentence: e.en.trim().to_string(),
                translation: e.zh.trim().to_string(),
            })
            .collect();
        match WordExampleService::new(self.pool(), self.logger())
            .save(args.word_id, given, mode)
            .await
        {
            Ok(examples) => done(
                json!({ "examples": examples.iter().map(|e| json!({ "en": e.sentence, "zh": e.translation })).collect::<Vec<_>>() }),
                format!("保存了例句（现在共 {} 句）", examples.len()),
                None,
            ),
            Err(e) => failed("没能保存例句", e),
        }
    }

    #[tool(
        description = "Statistics of word books: overall (books, words, learned) or one book's parts of speech and kinds.",
        annotations(read_only_hint = true)
    )]
    async fn word_book_stats(
        &self,
        Parameters(args): Parameters<OptionalBookArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let result = match args.book_id {
            Some(id) => crate::handlers::get_word_book_statistics(self.app.clone(), id)
                .await
                .map(|s| serde_json::to_value(&s).unwrap_or(Value::Null)),
            None => crate::handlers::get_global_word_book_statistics(self.app.clone())
                .await
                .map(|s| serde_json::to_value(&s).unwrap_or(Value::Null)),
        };
        match result {
            Ok(v) => done(v, "看了词汇本的统计".to_string(), None),
            Err(e) => failed("没能查看词汇本统计", e),
        }
    }
}
