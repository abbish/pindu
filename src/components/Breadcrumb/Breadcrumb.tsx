import React from 'react';
import styles from './Breadcrumb.module.css';

export interface BreadcrumbItem {
  /** Breadcrumb item label */
  label: string;
  /** Navigation key */
  key: string;
  /** Icon for the item (Font Awesome class) */
  icon?: string;
  /** Additional parameters for navigation */
  params?: any;
}

export interface BreadcrumbProps {
  /** Breadcrumb items */
  items: BreadcrumbItem[];
  /** Current page title */
  current: string;
  /** Navigation handler */
  onNavigate?: (key: string, params?: any) => void;
  /** Loading state */
  loading?: boolean;
}

/**
 * Breadcrumb navigation component
 */
export const Breadcrumb: React.FC<BreadcrumbProps> = ({
  items,
  current,
  onNavigate,
  loading = false
}) => {
  const handleItemClick = (item: BreadcrumbItem) => {
    onNavigate?.(item.key, item.params);
  };

  if (loading) {
    return (
      <div className={styles.breadcrumb}>
        <div className={styles.loading}>
          <i className={`fas fa-spinner ${styles.loadingSpinner}`} />
          <div className={`${styles.skeleton} ${styles.short}`} />
          <i className={`fas fa-chevron-right ${styles.separator}`} />
          <div className={`${styles.skeleton} ${styles.medium}`} />
          <i className={`fas fa-chevron-right ${styles.separator}`} />
          <div className={`${styles.skeleton} ${styles.long}`} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.breadcrumb}>
      <nav className={styles.nav} aria-label="面包屑导航">
        {items.map((item, index) => (
          <div key={item.key} className={styles.item}>
            <button
              className={`${styles.link} ${item.icon ? styles.withIcon : ''}`}
              onClick={() => handleItemClick(item)}
              title={`前往 ${item.label}`}
            >
              {item.icon && <i className={`fas fa-${item.icon} ${styles.icon}`} />}
              <span>{item.label}</span>
            </button>
            {index < items.length - 1 && (
              <i className={`fas fa-chevron-right ${styles.separator}`} />
            )}
          </div>
        ))}
        
        {items.length > 0 && (
          <i className={`fas fa-chevron-right ${styles.separator}`} />
        )}
        
        <span className={styles.current} title={current}>
          {current}
        </span>
      </nav>
    </div>
  );
};

export default Breadcrumb;