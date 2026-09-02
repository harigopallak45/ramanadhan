import { NavLink } from 'react-router-dom';
import UserMenu from './UserMenu';

const LOGO = 'https://assets.cdn.filesafe.space/wDk2dm52D9L325zEgO6S/media/69d63d6bebf1a608432cce2d.png';

export default function Topbar({ tabs, right }) {
  return (
    <header className="topbar">
      <div className="brand">
        <img src={LOGO} alt="Centinl" />
        {tabs && (
          <nav className="nav-tabs">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
                {t.label}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
      <div className="row gap-3">
        {right}
        <UserMenu />
      </div>
    </header>
  );
}
