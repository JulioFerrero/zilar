import { BrowserRouter } from 'react-router';
import { AppRoutes } from '@/routes/AppRoutes';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';

export function App() {
  return (
    <ChatStoreProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ChatStoreProvider>
  );
}
