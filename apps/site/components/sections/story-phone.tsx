import styles from './story.module.css';
import { ApprovalPanel, FriendsPanel, RoutinePanel, WorkPanel } from './story-panels';

export function StoryPhone() {
  return (
    <div className={styles.phone3d}>
      <div className={styles.phone} data-phone aria-label="Zilar on a phone">
        <div className={styles.screen}>
          <FriendsPanel />
          <WorkPanel />
          <ApprovalPanel />
          <RoutinePanel />
        </div>
      </div>
    </div>
  );
}
