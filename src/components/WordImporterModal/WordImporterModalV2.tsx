import React, { useState, useEffect } from 'react';
import { Modal, Button, WordGrid } from '../';
import type { AnalysisProgress, AIModel, WordExtractionMode } from '../../types';
import type { ExtractedWord } from '../WordGrid';
import { WordBookService } from '../../services/wordbookService';
import { AIModelService } from '../../services/aiModelService';
import styles from './WordImporterModal.module.css';

export interface WordImporterModalV2Props {
  /** 是否显示模态框 */
  isOpen: boolean;
  /** 关闭模态框回调 */
  onClose: () => void;
  /** 保存单词回调 */
  onSaveWords: (words: ExtractedWord[]) => Promise<void>;
  /** 保存状态 */
  saving: boolean;
}

type Step = 'input' | 'analyzing' | 'selection';

/**
 * 单词导入模态框组件 V2 - 三步骤交互
 */
export const WordImporterModalV2: React.FC<WordImporterModalV2Props> = ({
  isOpen,
  onClose,
  onSaveWords,
  saving
}) => {
  const [currentStep, setCurrentStep] = useState<Step>('input');
  const [textContent, setTextContent] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
  const [extractedWords, setExtractedWords] = useState<ExtractedWord[]>([]);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<'network' | 'parsing' | 'timeout' | 'validation' | 'size' | 'auth' | 'rate_limit' | 'unknown'>('unknown');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  // const [analysisResult, setAnalysisResult] = useState<any>(null);
  // const [analysisPromiseRef, setAnalysisPromiseRef] = useState<Promise<any> | null>(null);
  const [extractionMode, setExtractionMode] = useState<WordExtractionMode>('focus');
  const [pollIntervalRef, setPollIntervalRef] = useState<number | null>(null);
  const [pollTimeoutRef, setPollTimeoutRef] = useState<number | null>(null);

  // 添加状态变化监听
  const handleExtractionModeChange = (mode: WordExtractionMode) => {
    console.log('🎯 Extraction Mode Changed:', mode);
    setExtractionMode(mode);
  };

  // 清理轮询的函数
  const clearPolling = () => {
    console.log('Clearing polling timers...');

    if (pollIntervalRef) {
      clearInterval(pollIntervalRef);
      setPollIntervalRef(null);
      console.log('Cleared poll interval');
    }
    if (pollTimeoutRef) {
      clearTimeout(pollTimeoutRef);
      setPollTimeoutRef(null);
      console.log('Cleared poll timeout');
    }
  };

  const wordBookService = new WordBookService();
  const aiModelService = new AIModelService();

  // 组件卸载时清理轮询和取消后端分析
  useEffect(() => {
    return () => {
      console.log('Component unmounting, cleaning up...');
      clearPolling();

      // 组件卸载时尝试取消后端分析
      if (currentStep === 'analyzing') {
        wordBookService.cancelAnalysis().catch(err => {
          console.error('Failed to cancel analysis on unmount:', err);
        });
      }
    };
  }, [currentStep]);

  // 智能错误处理函数
  const handleError = (errorMessage: string, context?: string) => {
    console.error('Analysis error:', errorMessage, context);

    let userFriendlyMessage = '';
    let errorType: 'network' | 'parsing' | 'timeout' | 'validation' | 'size' | 'auth' | 'rate_limit' | 'unknown' = 'unknown';

    // 根据错误信息分类处理，优先匹配具体错误
    if (errorMessage.includes('JSON parsing error') || errorMessage.includes('XML parsing error') || errorMessage.includes('Failed to parse')) {
      errorType = 'parsing';
      userFriendlyMessage = 'AI返回的数据格式异常，这通常是由于：\n• 文本内容过于复杂或包含特殊字符\n• AI模型输出格式不稳定\n• 网络传输中断导致数据不完整\n\n建议解决方案：\n• 减少文本长度（建议少于2000字符）\n• 简化文本内容，移除特殊符号\n• 更换其他AI模型重试';
    } else if (errorMessage.includes('timeout') || errorMessage.includes('超时') || errorMessage.includes('Request timeout')) {
      errorType = 'timeout';
      userFriendlyMessage = '分析请求超时，可能原因：\n• 文本内容过长，AI处理时间超出限制\n• 网络连接不稳定\n• AI服务响应缓慢\n\n建议解决方案：\n• 将文本分段处理，每次处理1000-2000字符\n• 检查网络连接稳定性\n• 选择响应更快的AI模型\n• 稍后重试';
    } else if (errorMessage.includes('文本内容过长') || errorMessage.includes('文件大小') || errorMessage.includes('limit')) {
      errorType = 'size';
      userFriendlyMessage = '文本内容超出处理限制：\n• 当前文本长度过长\n• 建议将文本分段处理\n• 每次处理建议不超过2000字符\n• 可以分多次导入后合并';
    } else if (errorMessage.includes('401') || errorMessage.includes('unauthorized') || errorMessage.includes('API key')) {
      errorType = 'auth';
      userFriendlyMessage = 'AI服务认证失败：\n• API密钥可能已过期或无效\n• 请检查AI模型配置\n• 联系管理员更新API密钥';
    } else if (errorMessage.includes('429') || errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
      errorType = 'rate_limit';
      userFriendlyMessage = 'AI服务使用频率超限：\n• 请求过于频繁，触发限流\n• 请等待几分钟后重试\n• 考虑升级AI服务套餐';
    } else if (errorMessage.includes('network') || errorMessage.includes('连接') || errorMessage.includes('请求失败') || errorMessage.includes('connection')) {
      errorType = 'network';
      userFriendlyMessage = '网络连接异常：\n• 请检查网络连接是否正常\n• AI服务可能暂时不可用\n• 防火墙或代理设置可能阻止连接\n• 稍后重试';
    } else if (errorMessage.includes('文本内容') || errorMessage.includes('validation') || errorMessage.includes('不能为空')) {
      errorType = 'validation';
      userFriendlyMessage = '输入内容验证失败：\n• 文本内容不能为空\n• 请检查文本格式是否正确\n• 确保选择了有效的AI模型';
    } else {
      errorType = 'unknown';
      // 显示原始错误信息，但添加友好的前缀
      userFriendlyMessage = `分析过程中出现问题：\n\n具体错误：${errorMessage}\n\n建议解决方案：\n• 检查文本内容和格式\n• 尝试更换AI模型\n• 减少文本长度后重试\n• 如问题持续，请联系技术支持`;
    }

    // 清理轮询和进度
    clearPolling();

    setError(userFriendlyMessage);
    setErrorType(errorType);
    setCurrentStep('input');
  };

  // 清除错误状态
  const clearError = () => {
    setError(null);
    setErrorType('unknown');
  };

  // 获取错误图标
  const getErrorIcon = (type: string): string => {
    switch (type) {
      case 'network': return 'fa-wifi';
      case 'parsing': return 'fa-code';
      case 'timeout': return 'fa-clock';
      case 'validation': return 'fa-edit';
      case 'size': return 'fa-file-alt';
      case 'auth': return 'fa-key';
      case 'rate_limit': return 'fa-tachometer-alt';
      default: return 'fa-exclamation-triangle';
    }
  };

  // 获取错误标题
  const getErrorTitle = (type: string): string => {
    switch (type) {
      case 'network': return '网络连接错误';
      case 'parsing': return '数据解析错误';
      case 'timeout': return '请求超时';
      case 'validation': return '输入验证错误';
      case 'size': return '文件大小超限';
      case 'auth': return '认证失败';
      case 'rate_limit': return '请求频率超限';
      default: return '分析错误';
    }
  };



  // 转换词性缩写
  const convertPOSAbbreviation = (pos: string): ExtractedWord['partOfSpeech'] => {
    if (!pos) return 'n.';

    const normalizedPos = pos.toLowerCase().replace(/\./g, '').trim();
    const posMap: Record<string, ExtractedWord['partOfSpeech']> = {
      'n': 'n.',
      'noun': 'n.',
      'nouns': 'n.',
      'v': 'v.',
      'verb': 'v.',
      'verbs': 'v.',
      'adj': 'adj.',
      'adjective': 'adj.',
      'adjectives': 'adj.',
      'adv': 'adv.',
      'adverb': 'adv.',
      'adverbs': 'adv.',
      'prep': 'prep.',
      'preposition': 'prep.',
      'prepositions': 'prep.',
      'conj': 'conj.',
      'conjunction': 'conj.',
      'conjunctions': 'conj.',
      'int': 'int.',
      'interjection': 'int.',
      'interjections': 'int.',
      'pron': 'pron.',
      'pronoun': 'pron.',
      'pronouns': 'pron.',
      'art': 'art.',
      'article': 'art.',
      'articles': 'art.',
      'det': 'det.',
      'determiner': 'det.',
      'determiners': 'det.'
    };
    return (posMap[normalizedPos] as ExtractedWord['partOfSpeech']) || 'n.';
  };

  // 转换 PhonicsWord 到 ExtractedWord
  const convertPhonicsToExtracted = (phonicsWords: any[]): ExtractedWord[] => {
    return phonicsWords.map((word, index) => ({
      id: `${index + 1}`,
      word: word.word,
      meaning: word.chinese_translation,
      partOfSpeech: convertPOSAbbreviation(word.pos_abbreviation),
      frequency: word.frequency || 1,
      selected: true, // 默认选中所有单词
      // 添加自然拼读特有的信息
      phonics: {
        ipa: word.ipa,
        syllables: word.syllables,
        phonics_rule: word.phonics_rule,
        analysis_explanation: word.analysis_explanation,
        pos_abbreviation: word.pos_abbreviation,
        pos_english: word.pos_english,
        pos_chinese: word.pos_chinese,
        frequency: word.frequency
      }
    }));
  };

  // 加载可用模型
  useEffect(() => {
    const loadModels = async () => {
      try {
        const result = await aiModelService.getAIModels();
        if (result.success) {
          // 转换AIModelConfig到AIModel格式
          const models: AIModel[] = result.data.map(config => ({
            id: config.id,
            provider_id: config.provider.id,
            name: config.name,
            display_name: config.display_name,
            model_id: config.model_id,
            description: config.description,
            max_tokens: config.max_tokens,
            temperature: config.temperature,
            is_active: config.is_active,
            is_default: config.is_default,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }));
          setAvailableModels(models);
          // 自动选择第一个模型
          if (result.data.length > 0) {
            setSelectedModel(result.data[0].id.toString());
          }
        }
      } catch (err) {
        console.error('Failed to load AI models:', err);
      }
    };

    if (isOpen) {
      loadModels();
    }
  }, [isOpen]);

  // 重置状态
  const resetState = () => {
    console.log('Resetting all state...');

    // 清理轮询和定时器
    clearPolling();

    // 重置所有状态
    setCurrentStep('input');
    setTextContent('');
    setExtractedWords([]);
    setAnalysisProgress(null);
    setError(null);
    setErrorType('unknown');
    setUploadedFileName(null);

    console.log('State reset completed');
  };

  // 处理文件上传
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 检查文件类型
    const allowedTypes = ['text/plain', 'text/markdown'];
    const allowedExtensions = ['.txt', '.md', '.markdown'];

    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    const isValidType = allowedTypes.includes(file.type) || allowedExtensions.includes(fileExtension);

    if (!isValidType) {
      setError('请上传 .txt 或 .md 文件');
      return;
    }

    // 检查文件大小 (限制为5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
      handleError(`文件大小超出限制：当前文件 ${fileSizeMB}MB，最大支持 5MB`, 'File size exceeded');
      return;
    }

    try {
      const text = await file.text();
      setTextContent(text);
      setUploadedFileName(file.name);
      setError(null);
    } catch (err) {
      setError('文件读取失败，请重试');
    }

    // 清空input值，允许重复上传同一文件
    event.target.value = '';
  };

  // 清除上传的文件
  const handleClearFile = () => {
    setTextContent('');
    setUploadedFileName(null);
    setError(null);
  };

  // 取消分析
  const handleCancelAnalysis = async () => {
    console.log('Cancelling analysis...');

    // 立即清理前端状态，避免用户等待
    clearPolling();

    try {
      // 通知后端取消分析
      console.log('Sending cancel request to backend...');
      await wordBookService.cancelAnalysis();
      console.log('Backend cancel request completed');
    } catch (error) {
      console.error('Failed to cancel backend analysis:', error);
      // 即使后端取消失败，也要清理前端状态
    }

    // 重置所有状态
    resetState();
    setCurrentStep('input');
    console.log('Analysis cancelled and state reset');
  };

  // 关闭模态框
  const handleClose = async () => {
    // 如果正在分析中，询问用户是否确认关闭
    if (currentStep === 'analyzing') {
      if (window.confirm('分析正在进行中，确定要关闭吗？这将中断当前分析。')) {
        console.log('User confirmed to close during analysis');

        // 先取消分析
        try {
          await wordBookService.cancelAnalysis();
          console.log('Analysis cancelled before closing');
        } catch (error) {
          console.error('Failed to cancel analysis before closing:', error);
        }

        resetState();
        onClose();
      }
    } else {
      resetState();
      onClose();
    }
  };

  // 开始分析
  const handleStartAnalysis = async () => {
    if (!textContent.trim()) {
      handleError('请输入要分析的文本内容', 'Empty text content');
      return;
    }

    if (!selectedModel) {
      handleError('请选择AI模型', 'No model selected');
      return;
    }

    // 检查文本长度
    const textLength = textContent.trim().length;
    if (textLength > 5000) {
      handleError(`文本内容过长：当前 ${textLength} 字符，建议控制在 5000 字符以内`, 'Text too long');
      return;
    }

    // 如果文本较长，给出警告但允许继续
    if (textLength > 3000) {
      const shouldContinue = window.confirm(
        `文本内容较长（${textLength} 字符），分析可能需要较长时间。\n\n建议：\n• 分段处理可以提高成功率\n• 较长文本可能导致AI输出不稳定\n\n是否继续分析？`
      );
      if (!shouldContinue) {
        return;
      }
    }

    // 清除之前的错误状态
    clearError();
    setCurrentStep('analyzing');

    try {
      // 清除之前的进度
      await wordBookService.clearAnalysisProgress();



      // 开始分析（这是异步的，会在后台进行）
      const analysisPromise = aiModelService.analyzePhonics(
        textContent,
        parseInt(selectedModel),
        extractionMode
      );

      // 保存Promise引用供轮询使用
      // setAnalysisPromiseRef(analysisPromise);

      // 启动轮询进度，传入Promise引用
      // const pollInterval = startProgressPolling(analysisPromise);
      startProgressPolling(analysisPromise);

      // 不等待分析完成，让轮询来处理进度更新
      // 但同时监听Promise完成，作为备用机制
      analysisPromise.then(result => {
        if (result.success && result.data && result.data.words && result.data.words.length > 0) {
          // 分析成功且有结果
          const convertedWords = convertPhonicsToExtracted(result.data.words);
          setExtractedWords(convertedWords);
          setCurrentStep('selection');
        } else if (result.success && result.data && result.data.words && result.data.words.length === 0) {
          // 分析成功但没有单词，可能是被取消了
          console.log('Analysis completed with empty result, likely cancelled');
          // 不需要处理，取消操作已经在handleCancelAnalysis中处理了
        } else if (!result.success) {
          // API返回了错误
          console.error('Analysis API returned error:', result.error);
          handleError(result.error || '分析失败', 'API returned error');
        } else {
          // 真正的错误
          handleError('分析完成但未获取到有效结果', 'Promise resolved with invalid result');
        }
      }).catch(err => {
        console.error('Analysis promise rejected:', err);
        // 尝试从错误对象中提取更详细的信息
        let errorMessage = '分析失败';
        if (err instanceof Error) {
          errorMessage = err.message;
        } else if (typeof err === 'string') {
          errorMessage = err;
        } else if (err && typeof err === 'object' && err.error) {
          errorMessage = err.error;
        }
        handleError(errorMessage, 'Promise rejected');
      });

    } catch (err) {
      handleError(err instanceof Error ? err.message : '分析失败', 'Analysis initiation failed');
    }
  };

  // 轮询进度
  const startProgressPolling = (analysisPromise: Promise<any>) => {
    // 清理之前的轮询
    clearPolling();

    const pollInterval = setInterval(async () => {
      try {
        const result = await wordBookService.getAnalysisProgress();
        if (result.success && result.data) {
          setAnalysisProgress(result.data);

          if (result.data.status === 'completed') {
            clearPolling();

            // 分析完成，直接从Promise获取结果
            analysisPromise.then(analysisResult => {
              if (analysisResult.success && analysisResult.data && analysisResult.data.words) {
                const convertedWords = convertPhonicsToExtracted(analysisResult.data.words);
                setExtractedWords(convertedWords);
                console.log('Converted words:', convertedWords);
                setCurrentStep('selection');
              } else {
                handleError('分析完成但未获取到有效结果，请重试', 'Progress completed but no valid result');
              }
            }).catch(err => {
              handleError('获取分析结果失败：' + (err.message || '未知错误'), 'Failed to get analysis result from progress');
            });
          } else if (result.data.status === 'error') {
            clearPolling();
            // 使用后端返回的详细错误信息
            const errorMsg = result.data.error_message || '分析失败';
            console.error('Backend analysis error:', errorMsg);
            handleError(errorMsg, 'Progress status error');
          }
        } else {
          // API调用成功但没有返回有效数据
          console.warn('Progress API returned success but no valid data:', result);
        }
      } catch (err) {
        console.error('Progress polling error:', err);
        clearPolling();
        // 轮询错误通常是网络问题，不应该显示给用户，除非是持续错误
        // 这里只记录日志，让超时机制处理
      }
    }, 500); // 每0.5秒轮询一次，更频繁的更新

    // 设置超时 - 增加到10分钟，因为复杂文本的AI分析可能需要较长时间
    const timeoutId = setTimeout(() => {
      clearPolling();
      if (currentStep === 'analyzing') {
        handleError('分析超时（超过10分钟），请尝试减少文本长度或稍后重试', 'Analysis timeout');
      }
    }, 600000); // 10分钟超时

    // 保存轮询引用
    setPollIntervalRef(pollInterval);
    setPollTimeoutRef(timeoutId);

    return pollInterval;
  };

  // 重新分析
  const handleReanalyze = () => {
    // 清理当前状态
    clearPolling();
    setExtractedWords([]);
    setAnalysisProgress(null);
    setError(null);
    // setAnalysisResult(null);
    // setAnalysisPromiseRef(null);

    // 重新开始分析
    handleStartAnalysis();
  };

  // 显示大文件处理帮助
  const handleShowSizeHelp = () => {
    const helpMessage = `处理大文件的建议方法：

1. 文本分段处理：
   • 将大文本分成多个小段（建议每段1000-2000字符）
   • 分别进行分析和导入
   • 最后在单词本中统一管理

2. 优化文本内容：
   • 移除不必要的格式符号和特殊字符
   • 保留核心的英文单词和句子
   • 删除重复内容

3. 选择合适的AI模型：
   • 某些模型对长文本处理能力更强
   • 可以尝试不同的模型进行分析

4. 分批导入：
   • 可以多次使用导入功能
   • 系统会自动去重和合并单词

是否要继续尝试分析当前文本？`;

    if (window.confirm(helpMessage)) {
      handleStartAnalysis();
    }
  };

  // 返回输入步骤
  // const handleBackToInput = () => {
  //   setCurrentStep('input');
  //   setExtractedWords([]);
  //   setAnalysisProgress(null);
  //   setError(null);
  //   setAnalysisResult(null);
  //   setAnalysisPromiseRef(null);
  // };

  // 单词选择切换
  const handleWordToggle = (wordId: string) => {
    setExtractedWords(prev => 
      prev.map(word => 
        word.id === wordId 
          ? { ...word, selected: !word.selected }
          : word
      )
    );
  };

  // 全选/取消全选
  const handleSelectAll = (selected: boolean) => {
    setExtractedWords(prev => 
      prev.map(word => ({ ...word, selected }))
    );
  };

  // 保存选中的单词
  const handleSaveSelectedWords = async () => {
    const selectedWords = extractedWords.filter(word => word.selected);
    if (selectedWords.length === 0) {
      setError('请至少选择一个单词');
      return;
    }

    try {
      await onSaveWords(selectedWords);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  };

  // 渲染输入步骤
  const renderInputStep = () => (
    <div className={styles.stepContent}>
      <div className={styles.stepHeader}>
        <h3>步骤 1: 输入文本</h3>
        <p>请输入要分析的英文文本，或上传 .txt/.md 文件，AI将为您提取单词并进行自然拼读分析</p>
      </div>

      <div className={styles.inputSection}>
        {/* 文件上传区域 */}
        <div className={styles.uploadSection}>
          <div className={styles.uploadArea}>
            <input
              type="file"
              id="fileUpload"
              className={styles.fileInput}
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              onChange={handleFileUpload}
            />
            <label htmlFor="fileUpload" className={styles.uploadLabel}>
              <i className="fas fa-cloud-upload-alt" />
              <span>点击上传文件</span>
              <small>支持 .txt 和 .md 文件，最大 5MB</small>
            </label>
          </div>

          {uploadedFileName && (
            <div className={styles.uploadedFile}>
              <div className={styles.fileName}>
                <i className="fas fa-file-alt" />
                <span>{uploadedFileName}</span>
              </div>
              <button
                type="button"
                className={styles.clearFileBtn}
                onClick={handleClearFile}
                title="清除文件"
              >
                <i className="fas fa-times" />
              </button>
            </div>
          )}
        </div>

        {/* 分隔线 */}
        <div className={styles.divider}>
          <span>或者</span>
        </div>

        {/* 文本输入区域 */}
        <textarea
          className={styles.textInput}
          placeholder="直接输入英文文本..."
          value={textContent}
          onChange={(e) => setTextContent(e.target.value)}
          rows={8}
        />
      </div>

      <div className={styles.modelSection}>
        <label className={styles.modelLabel}>选择AI模型:</label>
        <select
          className={styles.modelSelect}
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          aria-label="选择AI模型"
        >
          <option value="">请选择模型</option>
          {availableModels.map(model => (
            <option key={model.id} value={model.id.toString()}>
              {model.display_name}
            </option>
          ))}
        </select>
      </div>

      {/* 提取模式选择 */}
      <div className={styles.extractionModeSection}>
        <label className={styles.modelLabel}>提取模式:</label>
        <div className={styles.modeOptions}>
          <label className={`${styles.modeOption} ${extractionMode === 'focus' ? styles.selected : ''}`}>
            <input
              type="radio"
              name="extractionMode"
              value="focus"
              checked={extractionMode === 'focus'}
              onChange={(e) => handleExtractionModeChange(e.target.value as WordExtractionMode)}
              className={styles.modeRadio}
            />
            <div className={styles.modeContent}>
              <div className={styles.modeTitle}>
                <i className="fas fa-bullseye" />
                重点模式（推荐）
              </div>
              <div className={styles.modeDescription}>
                过滤掉 a、the、is 等简单词汇，专注于有学习价值的单词
              </div>
            </div>
          </label>

          <label className={`${styles.modeOption} ${extractionMode === 'all' ? styles.selected : ''}`}>
            <input
              type="radio"
              name="extractionMode"
              value="all"
              checked={extractionMode === 'all'}
              onChange={(e) => handleExtractionModeChange(e.target.value as WordExtractionMode)}
              className={styles.modeRadio}
            />
            <div className={styles.modeContent}>
              <div className={styles.modeTitle}>
                <i className="fas fa-list" />
                全量模式
              </div>
              <div className={styles.modeDescription}>
                提取文本中的所有单词，包括简单的功能词
              </div>
            </div>
          </label>
        </div>
      </div>

      {error && (
        <div className={`${styles.error} ${styles[`error${errorType.charAt(0).toUpperCase() + errorType.slice(1)}`] || ''}`}>
          <div className={styles.errorHeader}>
            <i className={`fas ${getErrorIcon(errorType)}`} />
            <span className={styles.errorTitle}>{getErrorTitle(errorType)}</span>
          </div>
          <div className={styles.errorMessage}>
            {error.split('\n').map((line, index) => (
              <div key={index} className={styles.errorLine}>
                {line}
              </div>
            ))}
          </div>
          <div className={styles.errorActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={clearError}
            >
              知道了
            </Button>
            {(errorType === 'parsing' || errorType === 'timeout' || errorType === 'network' || errorType === 'unknown') && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  clearError();
                  handleStartAnalysis();
                }}
              >
                重新分析
              </Button>
            )}
            {errorType === 'size' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  clearError();
                  handleShowSizeHelp();
                }}
              >
                了解分段处理
              </Button>
            )}
          </div>
        </div>
      )}

      <div className={styles.stepActions}>
        <Button variant="secondary" onClick={handleClose}>
          取消
        </Button>
        <Button 
          variant="primary" 
          onClick={handleStartAnalysis}
          disabled={!textContent.trim() || !selectedModel}
        >
          开始分析
        </Button>
      </div>
    </div>
  );

  // 渲染分析进度步骤
  const renderAnalyzingStep = () => (
    <div className={styles.stepContent}>
      <div className={styles.stepHeader}>
        <h3>步骤 2: AI分析中</h3>
        <p>正在使用AI模型分析您的文本，请稍候...</p>
      </div>

      <div className={styles.progressSection}>
        {analysisProgress && (
          <>
            <div className={styles.progressInfo}>
              <div className={styles.progressStep}>
                <i className="fas fa-cog fa-spin" />
                {analysisProgress.current_step}
              </div>
              
              <div className={styles.progressStats}>
                <div className={styles.progressStat}>
                  <span className={styles.statLabel}>已接收:</span>
                  <span className={styles.statValue}>{analysisProgress.chunks_received} 块</span>
                </div>
                <div className={styles.progressStat}>
                  <span className={styles.statLabel}>字符数:</span>
                  <span className={styles.statValue}>{analysisProgress.total_chars.toLocaleString()}</span>
                </div>
                <div className={styles.progressStat}>
                  <span className={styles.statLabel}>用时:</span>
                  <span className={styles.statValue}>{analysisProgress.elapsed_seconds.toFixed(1)}s</span>
                </div>
              </div>

              {analysisProgress.elapsed_seconds > 60 && (
                <div className={styles.progressTip}>
                  <i className="fas fa-info-circle" />
                  <span>复杂文本分析需要较长时间，请耐心等待。通常需要3-8分钟。</span>
                </div>
              )}
            </div>

            <div className={styles.progressBar}>
              <div
                className={`${styles.progressFill} ${
                  analysisProgress.status === 'completed' ? styles.progressComplete :
                  analysisProgress.chunks_received > 0 ? styles.progressActive : styles.progressStarted
                }`}
              />
            </div>
          </>
        )}
      </div>

      <div className={styles.stepActions}>
        <Button
          variant="secondary"
          onClick={handleCancelAnalysis}
        >
          取消分析
        </Button>
      </div>
    </div>
  );

  // 渲染单词选择步骤
  const renderSelectionStep = () => (
    <div className={styles.stepContent}>
      <div className={styles.stepHeader}>
        <h3>步骤 3: 选择单词</h3>
        <p>请选择要添加到单词本的单词</p>
      </div>

      <div className={styles.selectionSection}>
        <WordGrid
          words={extractedWords}
          onWordToggle={handleWordToggle}
          onSelectAll={handleSelectAll}
        />
      </div>

      {error && (
        <div className={`${styles.error} ${styles[`error${errorType.charAt(0).toUpperCase() + errorType.slice(1)}`] || ''}`}>
          <div className={styles.errorHeader}>
            <i className={`fas ${getErrorIcon(errorType)}`} />
            <span className={styles.errorTitle}>{getErrorTitle(errorType)}</span>
          </div>
          <div className={styles.errorMessage}>
            {error.split('\n').map((line, index) => (
              <div key={index} className={styles.errorLine}>
                {line}
              </div>
            ))}
          </div>
          <div className={styles.errorActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={clearError}
            >
              知道了
            </Button>
          </div>
        </div>
      )}

      <div className={styles.stepActions}>
        <Button variant="secondary" onClick={handleReanalyze}>
          重新分析
        </Button>
        <Button variant="secondary" onClick={handleClose}>
          取消
        </Button>
        <Button 
          variant="primary" 
          onClick={handleSaveSelectedWords}
          disabled={saving || extractedWords.filter(w => w.selected).length === 0}
          loading={saving}
        >
          保存单词 ({extractedWords.filter(w => w.selected).length})
        </Button>
      </div>
    </div>
  );

  // 渲染当前步骤
  const renderCurrentStep = () => {
    switch (currentStep) {
      case 'input':
        return renderInputStep();
      case 'analyzing':
        return renderAnalyzingStep();
      case 'selection':
        return renderSelectionStep();
      default:
        return renderInputStep();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="补充单词"
      size="large"
    >
      <div className={styles.modalContent}>
        {/* 步骤指示器 */}
        <div className={styles.stepIndicator}>
          <div className={`${styles.step} ${currentStep === 'input' ? styles.active : ''} ${currentStep !== 'input' ? styles.completed : ''}`}>
            <div className={styles.stepNumber}>1</div>
            <div className={styles.stepLabel}>输入文本</div>
          </div>
          <div className={styles.stepConnector} />
          <div className={`${styles.step} ${currentStep === 'analyzing' ? styles.active : ''} ${currentStep === 'selection' ? styles.completed : ''}`}>
            <div className={styles.stepNumber}>2</div>
            <div className={styles.stepLabel}>AI分析</div>
          </div>
          <div className={styles.stepConnector} />
          <div className={`${styles.step} ${currentStep === 'selection' ? styles.active : ''}`}>
            <div className={styles.stepNumber}>3</div>
            <div className={styles.stepLabel}>选择单词</div>
          </div>
        </div>

        {/* 当前步骤内容 */}
        {renderCurrentStep()}
      </div>
    </Modal>
  );
};

export default WordImporterModalV2;
