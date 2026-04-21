import { getProjectSlug } from './api';
import ProjectView from './ProjectView';
import LandingPage from './components/landing/LandingPage';

export default function App() {
  if (!getProjectSlug()) return <LandingPage />;
  return <ProjectView />;
}
