import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/AuthContext';
import { FlagsProvider } from './lib/FlagsContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <FlagsProvider>
          <App />
        </FlagsProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
