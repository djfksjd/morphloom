import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  resetKey: string;
}

interface State {
  error?: string;
}

export class ViewportErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error.message : '3D 결과를 표시하지 못했습니다.' };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Morphloom viewport isolated an asset build failure.', error, info.componentStack);
  }

  componentDidUpdate(previous: Props): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: undefined });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="viewport-loading viewport-failure" role="alert">
        <b>이 결과만 표시를 중단했습니다</b>
        <span>{this.state.error}</span>
        <small>다른 결과를 선택하면 뷰어가 안전하게 다시 시작됩니다.</small>
      </div>
    );
  }
}
