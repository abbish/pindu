import { useState, useEffect, useCallback } from 'react';
import { AppError, handleDatabaseError } from '../utils/errorHandler';

export interface AsyncDataState<T> {
  data: T | null;
  loading: boolean;
  error: AppError | null;
  refresh: () => Promise<void>;
}

export function useAsyncData<T>(
  asyncFunction: () => Promise<T>,
  dependencies: any[] = []
): AsyncDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await asyncFunction();
      setData(result);
    } catch (err) {
      const appError = handleDatabaseError(err);
      setError(appError);
      console.error('Failed to load data:', appError);
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

// 专门用于多个异步操作的hook
export function useMultipleAsyncData<T extends Record<string, any>>(
  operations: { [K in keyof T]: () => Promise<T[K]> }
): {
  data: Partial<T>;
  loading: boolean;
  errors: Partial<Record<keyof T, AppError>>;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<Partial<T>>({});
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<keyof T, AppError>>>({});

  const loadAllData = useCallback(async () => {
    setLoading(true);
    setErrors({});
    
    const newData: Partial<T> = {};
    const newErrors: Partial<Record<keyof T, AppError>> = {};

    await Promise.allSettled(
      Object.entries(operations).map(async ([key, operation]) => {
        try {
          const result = await operation();
          newData[key as keyof T] = result;
        } catch (err) {
          const appError = handleDatabaseError(err);
          newErrors[key as keyof T] = appError;
          console.error(`Failed to load ${key}:`, appError);
        }
      })
    );

    setData(newData);
    setErrors(newErrors);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    await loadAllData();
  }, [loadAllData]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  return {
    data,
    loading,
    errors,
    refresh
  };
}