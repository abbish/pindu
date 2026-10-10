# Pindu.app (拼读)

[中文](./README.md) · [Install](./INSTALL.md) · [Contributing](./CONTRIBUTING.md) · [Security & privacy](./SECURITY.md)

Pindu is a desktop app for learning English vocabulary with phonics, available for macOS, Windows and Linux. Words are broken into phonics chunks (luggage → lug · gage) and then reinforced in passages and video clips.

- **Local first**: all data is stored in a local SQLite database. No account is required.
- **Bring your own keys**: AI features use any OpenAI-compatible endpoint you configure; speech uses Volcengine Doubao TTS.
- **Validated AI output**: model results pass tool-level validation and are checked again in Rust before they are saved.

> The user interface is currently available in Simplified Chinese only.

![Home](docs/screenshots/home.png)

## Features

### Vocabulary books

- Entries can be single words or phrases (phrasal verbs, collocations, idioms, fixed expressions). Phrases are marked as separable or not.
- Ways to add entries:
  - Type them in by hand and auto-fill the details with AI.
  - Generate them with AI from the book's scene description. The AI first suggests vocabulary topics, and you can pick several.
  - Extract new words and phrases from text, subtitles or documents (txt, md, srt, vtt, docx, pdf).
- Each entry is completed with IPA, syllables, phonics chunks, meanings and graded example sentences.
- Vocabulary books, passages and videos share tags. The sidebar groups related material by tag.

![Vocabulary book](docs/screenshots/wordbook.png)

### Study plans and practice

- Choose vocabulary books and a daily number of new words, and the schedule is generated automatically. Plans can be paused; the schedule shifts when you resume.
- New words are practised in three steps:
  1. Full information.
  2. English hidden; spell from memory.
  3. Chinese meaning, syllables and pronunciation only.
- Reviews follow a memory level with intervals of 1, 3, 7, 14 and 30 days. A correct answer moves the word up a level and a mistake sends it back to the first. Reviews that are due are added to the day's tasks automatically.

![Word practice](docs/screenshots/practice.png)

![Plan detail](docs/screenshots/plan.png)

### AI tutor

- Ask the AI tutor about any word card: meaning, spelling patterns, related words, usage, commonly confused words and memory aids. Follow-up questions are supported.
- The depth of explanations follows the learner profile (primary school, secondary school or adult).
- Sentences in passages and video clips can also be discussed with the tutor.

![AI tutor](docs/screenshots/tutor.png)

### Passages

- Ways to create passages:
  - Generate them from the words in vocabulary books or study plans. The AI plans the content first and writes each passage with a sentence-by-sentence translation.
  - Generate them from a topic description.
- When you import English material, the original text is kept unchanged. Only translations, a title, a level and key words are added.
- While reading:
  - Target words are highlighted, and clicking one opens its word card.
  - Passages can be played sentence by sentence or listened to with the text hidden.
  - Any word or phrase you select in the text can be added as a target word.
- Sentence analysis: sentence pattern, constituents, grammar points, communicative function, useful phrases and pronunciation notes.
- Comprehension exercises:
  - Cloze, multiple-choice and true/false questions are graded automatically.
  - Open questions are scored by the AI, which also suggests improvements.
- Passages can be added to study plans at a fixed interval.

![Passage reader](docs/screenshots/passage.png)

![Sentence analysis](docs/screenshots/sentence.png)

### Video library

- After you import a video and its subtitles, the AI segments and translates the subtitles and proposes how to cut the video into scenes.
- In the clip editor you can preview clips, adjust in and out points and correct the subtitle timing. Clips are cut precisely once you confirm the plan.
- Each clip can be studied in three ways: line-by-line study, shadowing with recording, and listen-and-spell. Clips can be added to study plans.
- Searching for an English word finds every clip in which it is spoken.
- ffmpeg is bundled with the app; no separate installation is needed.

![Video clips](docs/screenshots/clips.png)

![Clip editor](docs/screenshots/editor.png)

### Speech

- 15 English voices are built in. Words and sentences are always read in English, including numbers and dates.
- Sentence reading styles: teacher, natural, storytelling, news or a custom instruction. Speed, pitch and volume are adjustable.
- Synthesized audio is cached locally, so the same content is never requested twice.

## Installation

Download the installer for your system from [Releases](https://github.com/abbish/pindu/releases):

| System | Installer |
|---|---|
| macOS | `.dmg` |
| Windows | `-setup.exe` |
| Linux | AppImage, deb or rpm |

The installers are not signed with an Apple or Microsoft developer certificate, so the system asks for confirmation the first time the app is opened; see [INSTALL.md](./INSTALL.md#1-下载安装包) (Chinese). New versions are installed through in-app updates, which are verified against the app's signing key before installation.

After installation, configure these services in Settings:

- **AI models**: any OpenAI-compatible endpoint. OpenRouter, MiniMax, Moonshot and DeepSeek are preset.
- **Speech**: Volcengine Doubao TTS.

Without them, you can still manage vocabulary books by hand, practise and view statistics.

## Privacy

- There is no Pindu server and no usage tracking.
- The app connects to the network in two cases only:
  - When you use AI or speech features, the relevant content is sent directly to the provider you configured.
  - When it checks GitHub for updates. You can turn this off in Settings.
- API keys are stored in plain text in the local database and are never written to logs.

See [SECURITY.md](./SECURITY.md) for details.

## Development

```bash
npm install
npm run agent:install   # first time only: dependencies of the built-in AI agent
npm run tauri:dev       # development mode
npm run verify          # before committing: static checks plus frontend and backend tests
```

Tech stack:

| Part | Technology |
|---|---|
| UI | React 19, shadcn/ui, Tailwind CSS v4 |
| Desktop shell | Tauri 2 |
| Backend | Rust, SQLite |
| AI | Bundled agent process, built on [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) and compiled to a single executable with Bun |

Documentation:

- Architecture, database tables, AI tasks and development rules: [CLAUDE.md](./CLAUDE.md)
- AI agent design: [docs/agent-harness/](./docs/agent-harness/DESIGN.md)
- Contribution workflow: [CONTRIBUTING.md](./CONTRIBUTING.md)

Most documentation is in Chinese. Issues and pull requests in English are welcome.

## License

[MIT](./LICENSE) © 2023-2026 abbish and RedLark contributors

Third-party licenses are listed in [src-tauri/licenses/](./src-tauri/licenses/THIRD_PARTY_NOTICES.md).

<sub>Screenshots use demo data. Video frames are from *Tears of Steel* (© Blender Foundation, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), [mango.blender.org](https://mango.blender.org)).</sub>
