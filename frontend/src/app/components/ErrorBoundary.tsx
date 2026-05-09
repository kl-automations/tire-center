import { Component, type ErrorInfo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import i18n from "../../i18n";

type Props = {
  children: ReactNode;
  /** When this changes (e.g. route), clear the error so the next screen can render. */
  resetKey: string;
};

type State = { hasError: boolean };

function ErrorFallback({ onDismiss }: { onDismiss: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-foreground text-base font-medium max-w-sm">
        {i18n.t("errorBoundary.title")}
      </p>
      <button
        type="button"
        onClick={() => {
          onDismiss();
          navigate("/", { replace: true });
        }}
        className="bg-primary text-primary-foreground px-4 py-2.5 rounded-lg font-semibold text-sm"
      >
        {i18n.t("errorBoundary.returnHome")}
      </button>
    </div>
  );
}

/**
 * Catches render errors under the route tree so one broken screen does not
 * blank the whole app. Resets when `resetKey` changes (navigation).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary", error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onDismiss={() => this.setState({ hasError: false })} />;
    }
    return this.props.children;
  }
}
