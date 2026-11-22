'use client';

/**
 * Frontera de errores de React: si una zona de la UI falla de forma crítica,
 * se contiene aquí (la app sigue viva) y se ofrece recuperar la zona.
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  titulo: string;
}

interface State {
  error: Error | null;
}

export class FronteraError extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[Telar] Frontera de error (${this.props.titulo}):`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="tlr-frontera" role="alert">
          <h2>{this.props.titulo}</h2>
          <p>{this.state.error.message}</p>
          <button type="button" className="tlr-boton" onClick={() => this.setState({ error: null })}>
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
