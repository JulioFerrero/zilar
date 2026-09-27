import { BrowserRouter } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { AppRoutes } from '@/routes/AppRoutes';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';

export function App() {
  return (
    <AuthProvider>
      <ChatStoreProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ChatStoreProvider>
    </AuthProvider>
  );
}
