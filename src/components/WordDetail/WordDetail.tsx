import React from 'react';
import styles from './WordDetail.module.css';
import type { WordData } from '../WordCard';

export interface ExampleSentence {
  /** 英文例句 */
  english: string;
  /** 中文翻译 */
  chinese: string;
  /** 颜色主题 */
  color: 'green' | 'blue' | 'purple' | 'orange';
}

export interface WordDetailProps {
  /** 单词数据 */
  word: WordData;
  /** 例句列表 */
  examples?: ExampleSentence[];
  /** 词性标签 */
  partOfSpeech?: string;
  /** 词性类型 */
  wordType?: string;
  /** 详细定义 */
  definition?: string;
  /** 语法小贴士 */
  grammarTips?: string[];
  /** 播放例句发音回调 */
  onPlayExample?: (example: ExampleSentence) => void;
}

/**
 * 单词详解组件
 */
export const WordDetail: React.FC<WordDetailProps> = ({
  word,
  examples = [],
  partOfSpeech = '名词 (n.)',
  wordType = '可数名词',
  definition,
  grammarTips = [],
  onPlayExample
}) => {
  const defaultDefinition = `${word.meaning}是一种${word.description || '常见的物品或概念'}，在日常生活中经常使用。`;
  
  const defaultExamples: ExampleSentence[] = [
    {
      english: `I see a ${word.word.toLowerCase()} every day.`,
      chinese: `我每天都能看到${word.meaning}。`,
      color: 'green'
    },
    {
      english: `The ${word.word.toLowerCase()} is very beautiful.`,
      chinese: `这个${word.meaning}很漂亮。`,
      color: 'blue'
    },
    {
      english: `She likes this ${word.word.toLowerCase()}.`,
      chinese: `她喜欢这个${word.meaning}。`,
      color: 'purple'
    },
    {
      english: `Would you like a ${word.word.toLowerCase()}?`,
      chinese: `你想要一个${word.meaning}吗？`,
      color: 'orange'
    }
  ];

  const displayExamples = examples.length > 0 ? examples : defaultExamples;
  
  const defaultGrammarTips = [
    `单数形式：${word.word.toLowerCase().startsWith('a') || word.word.toLowerCase().startsWith('e') || word.word.toLowerCase().startsWith('i') || word.word.toLowerCase().startsWith('o') || word.word.toLowerCase().startsWith('u') ? 'an' : 'a'} ${word.word.toLowerCase()}`,
    `复数形式：${word.word.toLowerCase()}${word.word.toLowerCase().endsWith('s') || word.word.toLowerCase().endsWith('sh') || word.word.toLowerCase().endsWith('ch') || word.word.toLowerCase().endsWith('x') || word.word.toLowerCase().endsWith('z') ? 'es' : 's'}`,
    `常用搭配：see ${word.word.toLowerCase()}, like ${word.word.toLowerCase()}, have ${word.word.toLowerCase()}`
  ];

  const displayGrammarTips = grammarTips.length > 0 ? grammarTips : defaultGrammarTips;

  const handlePlayExample = (example: ExampleSentence) => {
    onPlayExample?.(example);
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <h3 className={styles.title}>
          <i className="fas fa-book-open" />
          单词详解
        </h3>
      </div>

      {/* Word Type and Definition */}
      <div className={styles.definitionSection}>
        <div className={styles.tags}>
          <span className={`${styles.tag} ${styles.tagPrimary}`}>
            {partOfSpeech}
          </span>
          <span className={`${styles.tag} ${styles.tagOrange}`}>
            {wordType}
          </span>
        </div>
        <p className={styles.definition}>
          <strong>定义：</strong>
          {definition || defaultDefinition}
        </p>
      </div>

      {/* Example Sentences */}
      <div className={styles.examplesSection}>
        <h4 className={styles.examplesTitle}>
          <i className="fas fa-quote-left" />
          例句学习
        </h4>

        <div className={styles.examples}>
          {displayExamples.map((example, index) => (
            <div 
              key={index} 
              className={`${styles.example} ${styles[`example_${example.color}`]}`}
            >
              <div className={styles.exampleContent}>
                <p className={styles.exampleEnglish}>{example.english}</p>
                <p className={styles.exampleChinese}>{example.chinese}</p>
              </div>
              <button 
                className={`${styles.playBtn} ${styles[`playBtn_${example.color}`]}`}
                onClick={() => handlePlayExample(example)}
                type="button"
                title="播放例句"
              >
                <i className="fas fa-volume-up" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Grammar Tips */}
      {displayGrammarTips.length > 0 && (
        <div className={styles.grammarSection}>
          <h5 className={styles.grammarTitle}>
            <i className="fas fa-lightbulb" />
            语法小贴士
          </h5>
          <ul className={styles.grammarTips}>
            {displayGrammarTips.map((tip, index) => (
              <li key={index} className={styles.grammarTip}>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default WordDetail;