import { Routes, Route, Navigate, useSearchParams } from "react-router-dom";
import AppShell from "./components/AppShell";
import SessionPage from "./pages/SessionPage";
import SearchPage from "./pages/SearchPage";
import TodosPage from "./pages/TodosPage";
import TasksPage from "./pages/TasksPage";
import PlansPage from "./pages/PlansPage";
import ChatPage from "./pages/ChatPage";
import StatsPage from "./pages/StatsPage";
import MemoryPage from "./pages/MemoryPage";

// Key ChatPage by `resume` so that navigating between /chat (New Chat) and
// /chat?resume=<sid> (or between two different resumed sessions) forces a
// full remount. Without this, ChatPage's internal state (chatId, ready, cwd,
// historyTurns, Composer draft, …) leaks across navigations.
function ChatRoute() {
  const [params] = useSearchParams();
  const k = params.get("resume") || "__new__";
  return <ChatPage key={k} />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/chat" replace />} />
        <Route path="/sessions/:sessionId" element={<SessionPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/todos" element={<TodosPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/tasks/:taskId" element={<TasksPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/plans/:name" element={<PlansPage />} />
        <Route path="/chat" element={<ChatRoute />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route path="/projects" element={<Navigate to="/chat" replace />} />
        <Route path="/projects/:encoded" element={<Navigate to="/chat" replace />} />
      </Route>
    </Routes>
  );
}
