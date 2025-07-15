import React from 'react';
import styles from './Header.module.css';

export interface HeaderProps {
  /** Current active navigation item */
  activeNav?: 'home' | 'plans' | 'wordbooks' | 'calendar' | 'settings';
  /** Navigation change handler */
  onNavChange?: (nav: string) => void;
  /** Hide navigation for study mode */
  hideNavigation?: boolean;
  /** Custom right content */
  rightContent?: React.ReactNode;
}

/**
 * Application header with navigation
 */
export const Header: React.FC<HeaderProps> = ({
  activeNav = 'home',
  onNavChange,
  hideNavigation = false,
  rightContent
}) => {
  const navItems = [
    { key: 'home', label: '首页', icon: 'home' },
    { key: 'plans', label: '学习计划', icon: 'tasks' },
    { key: 'wordbooks', label: '单词本', icon: 'bookmark' },
    { key: 'calendar', label: '日历', icon: 'calendar' },
    { key: 'settings', label: '设置', icon: 'cog' }
  ];

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <div className={styles.content}>
          {/* Logo and Title */}
          <div className={styles.brand}>
            <div className={styles.logo}>
              <i className="fas fa-book" />
            </div>
            <h1 className={styles.title}>自然拼读大师</h1>
          </div>

          {/* Navigation */}
          {!hideNavigation && (
            <nav className={styles.nav}>
              {navItems.map((item) => (
                <button
                  key={item.key}
                  className={`${styles.navItem} ${activeNav === item.key ? styles.navItemActive : ''}`}
                  onClick={() => onNavChange?.(item.key)}
                >
                  <i className={`fas fa-${item.icon}`} />
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          )}

          {/* Custom Content */}
          {rightContent && (
            <div className={styles.rightContent}>
              {rightContent}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;