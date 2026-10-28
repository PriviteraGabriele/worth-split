import { Component,type ReactNode } from 'react';

export class AsyncBoundary extends Component<{children:ReactNode;fallback:ReactNode},{hasError:boolean}>{
  state={hasError:false};

  static getDerivedStateFromError(){return {hasError:true}}

  render(){return this.state.hasError?this.props.fallback:this.props.children}
}

export function reloadApplication(){window.location.reload()}
