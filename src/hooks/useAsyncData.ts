import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { messageOf } from '../utils/errorHandler';

/** 加载失败的原因（已是给用户看的说法） */
export interface LoadError {
  message: string;
}

const toLoadError = (err: unknown): LoadError => ({ message: messageOf(err) ?? '加载失败，请重试' });

export interface AsyncDataState<T> {
  data: T | null;
  loading: boolean;
  error: LoadError | null;
  refresh: () => Promise<void>;
}

export function useAsyncData<T>(
  asyncFunction: () => Promise<T>,
  dependencies: React.DependencyList = []
): AsyncDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await asyncFunction();
      setData(result);
    } catch (err) {
      setError(toLoadError(err));
    } finally {
      setLoading(false);
    }
  }, dependencies);

  const refresh = useCallback(async () => {
    await loadData();
  }, [loadData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return {
    data,
    loading,
    error,
    refresh
  };
}
