import { Link } from 'react-router-dom';
import { Empty } from '../components/ui';
export default function NotFound() {
  return <div className="page"><Empty title="Page not found">The link may be old or mistyped. <Link to="/" className="text-link">Go to the dashboard</Link></Empty></div>;
}
