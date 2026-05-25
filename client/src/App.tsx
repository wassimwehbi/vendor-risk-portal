import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { DemoShowcase } from './pages/DemoShowcase';
import { NewAssessment } from './pages/NewAssessment';
import { ReviewWorkspace } from './pages/ReviewWorkspace';
import { ReportView } from './pages/ReportView';
import { AuditTrail } from './pages/AuditTrail';
import { Login } from './pages/Login';
import { useAuth } from './lib/AuthContext';
import { Spinner } from './components/ui';
import type { ReactNode } from 'react';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/showcase" element={<DemoShowcase />} />
        <Route path="/assessments/new" element={<NewAssessment />} />
        <Route path="/assessments/:id" element={<ReviewWorkspace />} />
        <Route path="/assessments/:id/report" element={<ReportView />} />
        <Route path="/assessments/:id/audit" element={<AuditTrail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
