import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/AppShell";
import SessionPage from "./pages/SessionPage";
import SearchPage from "./pages/SearchPage";
import TodosPage from "./pages/TodosPage";
import TasksPage from "./pages/TasksPage";
import PlansPage from "./pages/PlansPage";
import ChatPage from "./pages/ChatPage";
import StatsPage from "./pages/StatsPage";
import MemoryPage from "./pages/MemoryPage";

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
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/memory" element={<MemoryPage />} />
        {/* Old /projects routes redirect to /chat */}
        <Route path="/projects" element={<Navigate to="/chat" replace />} />
        <Route path="/projects/:encoded" element={<Navigate to="/chat" replace />} />
      </Route>
    </Routes>
  );
}
