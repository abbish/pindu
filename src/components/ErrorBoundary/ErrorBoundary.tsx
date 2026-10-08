import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

/** 渲染错误兜底：重试（重新渲染子树）/ 重新加载窗口；开发模式显示错误详情 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-8 text-foreground">
        <div className="flex w-full max-w-lg flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <TriangleAlert className="size-6" />
          </div>
          <h2 className="text-lg font-semibold">应用出错了</h2>
          <div className="flex gap-2">
            <Button onClick={this.handleRetry}>重试</Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              <RotateCw />
              刷新页面
            </Button>
          </div>
          {import.meta.env.DEV && this.state.error && (
            <details className="w-full rounded-lg border bg-muted/40 p-3 text-left text-xs">
              <summary className="cursor-default font-medium">错误详情</summary>
              <pre className="mt-2 max-h-80 overflow-auto font-mono whitespace-pre-wrap text-muted-foreground select-text">
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
