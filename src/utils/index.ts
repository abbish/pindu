// Utility functions
export const formatDate = (date: Date): string => {
  return date.toLocaleDateString();
};

export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};