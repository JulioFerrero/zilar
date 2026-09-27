import { Navigate, Route, Routes } from 'react-router';
import { ChatShell } from './ChatShell';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ChatShell />} />
      <Route path="/c/:chatId" element={<ChatShell />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
