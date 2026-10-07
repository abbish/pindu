import React from 'react';
import { Card } from '@/components/ui/card';
import { StudyCalendar } from '@/components/StudyCalendar/StudyCalendar';

export interface PlanOverviewViewProps {
  /** 计划 ID */
  planId: number;
}

/** 概览：计划日历 */
export const PlanOverviewView: React.FC<PlanOverviewViewProps> = ({ planId }) => (
  <Card className="p-4">
    <StudyCalendar planId={planId} />
  </Card>
);
