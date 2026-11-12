"use client";

import { Component, type ReactNode } from "react";

type Props<T> = {
  /** what to draw; a new value clears a previous rendering failure (keep it referentially stable) */
  value: T;
  render: (value: T, stale: boolean) => ReactNode;
  /** drawn over the fallback when rendering `value` failed */
  failure: (error: Error) => ReactNode;
};

type State = { error: Error | null };

/** Last line of defence: if even the previous drawing fails, only the message is left. */
class Guard extends Component<{ children: ReactNode; fallback: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}

/**
 * Error boundary around the circuit drawing. A rendering bug never leaves the
 * panel blank or broken: the last value that rendered fine is drawn greyed,
 * with the failure message over it. The next value is tried again normally.
 */
export class SafeRender<T> extends Component<Props<T>, State & { failed: T | null }> {
  state: State & { failed: T | null } = { error: null, failed: null };
  /** last value whose drawing reached the screen */
  private lastOk: { value: T } | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown) {
    console.error("[render]", error);
    this.setState({ failed: this.props.value });
  }

  componentDidMount() {
    if (!this.state.error) this.lastOk = { value: this.props.value };
  }

  componentDidUpdate() {
    if (!this.state.error) this.lastOk = { value: this.props.value };
    else if (this.state.failed !== null && this.props.value !== this.state.failed) this.setState({ error: null, failed: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.render(this.props.value, false);
    const message = this.props.failure(error);
    return (
      <Guard fallback={message}>
        {this.lastOk ? this.props.render(this.lastOk.value, true) : null}
        {message}
      </Guard>
    );
  }
}
