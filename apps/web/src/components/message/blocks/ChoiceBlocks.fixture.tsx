import type {
  AlertBlock as AlertBlockData,
  ButtonsBlock as ButtonsBlockData,
  ChecklistBlock as ChecklistBlockData,
  ChoiceBlock as ChoiceBlockData,
  FormBlock as FormBlockData,
  PollBlock as PollBlockData,
  RatingBlock as RatingBlockData,
} from '@zilar/protocol';
import { type ReactNode } from 'react';
import { AlertBlock } from './AlertBlock';
import { ButtonsBlock } from './ButtonsBlock';
import { ChecklistBlock } from './ChecklistBlock';
import { ChoiceBlock } from './ChoiceBlock';
import { FormBlock } from './FormBlock';
import { PollBlock } from './PollBlock';
import { RatingBlock } from './RatingBlock';

function Example({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="pl-1 font-mono text-[11px] tracking-[.06em] text-[#8a8a8a]">{label}</span>
      {children}
    </div>
  );
}

function Card({ time, children }: { time: string; children: ReactNode }) {
  return (
    <div className="flex w-full min-w-[280px] max-w-[380px] flex-col gap-[10px] rounded-[16px] border border-[#232323] bg-[#141414] px-[14px] pt-[12px] pb-[8px] text-[14px] leading-[20px] text-[#ededed]">
      {children}
      <div className="flex justify-end">
        <span className="font-mono text-[10px] text-[#8a8a8a]">{time}</span>
      </div>
    </div>
  );
}

const BOOK: ButtonsBlockData = {
  kind: 'buttons',
  id: 'book',
  text: 'Casa Paco has a table for 4 at 21:00. Book it?',
  actions: [
    { id: 'book', label: 'Book it', style: 'light' },
    { id: 'other', label: 'Another time', style: 'dark' },
    { id: 'skip', label: 'Skip', style: 'dark' },
  ],
};

const DINNER: PollBlockData = {
  kind: 'poll',
  id: 'dinner',
  question: 'Dinner on Friday?',
  options: [
    { id: 'sushi', label: 'Sushi', votes: 3 },
    { id: 'pizza', label: 'Pizza', votes: 5 },
    { id: 'tapas', label: 'Tapas', votes: 1 },
  ],
  votes: 9,
};

const CALL: ChoiceBlockData = {
  kind: 'choice',
  id: 'call',
  question: 'Which time works for the call?',
  options: ['17:00', '18:30', '20:00'],
  selected: 1,
};

const RESERVE: FormBlockData = {
  kind: 'form',
  id: 'reserve',
  title: 'Reserve a table',
  fields: [
    { id: 'day', label: 'Day', kind: 'text', value: 'Fri 17 Oct' },
    { id: 'time', label: 'Time', kind: 'text', value: '21:00' },
    { id: 'people', label: 'People', kind: 'number', value: '4' },
  ],
  submit: 'Send',
};

const RESERVE_OPEN: FormBlockData = {
  kind: 'form',
  id: 'reserve-open',
  title: 'Reserve a table',
  fields: [
    { id: 'day', label: 'Day', kind: 'date' },
    { id: 'time', label: 'Time', kind: 'text' },
    { id: 'people', label: 'People', kind: 'number', value: '0' },
  ],
  submit: 'Send',
};

const SUMMARY: RatingBlockData = {
  kind: 'rating',
  id: 'summary',
  prompt: 'How was this summary?',
  max: 5,
  selected: 4,
};

const SUMMARY_OPEN: RatingBlockData = {
  kind: 'rating',
  id: 'summary-open',
  prompt: 'How was this summary?',
  max: 5,
};

const BTC_ALERT: AlertBlockData = {
  kind: 'alert',
  id: 'btc-alert',
  title: 'Tell me when BTC goes above',
  field: { label: 'Price', value: '$90,000' },
  on: true,
  note: 'Checked every 5 min · now $82,302',
};

const BTC_ALERT_OFF: AlertBlockData = {
  ...BTC_ALERT,
  id: 'btc-alert-off',
  on: false,
};

const GROCERIES: ChecklistBlockData = {
  kind: 'checklist',
  id: 'groceries',
  title: 'Groceries',
  items: [
    { id: 'eggs', label: 'Eggs', done: true, by: 'Ana' },
    { id: 'milk', label: 'Milk', done: true, by: 'you' },
    { id: 'tomatoes', label: 'Tomatoes', done: false },
    { id: 'bread', label: 'Bread', done: false },
    { id: 'coffee', label: 'Coffee beans', done: false },
  ],
};

export default {
  'All examples': (
    <div className="min-h-screen bg-[#0a0a0a] p-10">
      <div className="flex flex-wrap items-start gap-8">
        <Example label="13 · BUTTONS">
          <div className="flex flex-col gap-4">
            <Card time="17:40">
              <ButtonsBlock block={BOOK} />
            </Card>
            <Card time="17:40">
              <ButtonsBlock block={BOOK} initialAnswer={{ label: 'Book it', at: new Date() }} />
            </Card>
          </div>
        </Example>
        <Example label="14 · POLL">
          <Card time="closes 18:00">
            <PollBlock block={DINNER} initialSelection={['pizza']} />
          </Card>
        </Example>
        <Example label="15 · PICK ONE">
          <Card time="12:02">
            <ChoiceBlock block={CALL} />
          </Card>
        </Example>
        <Example label="16 · QUICK FORM">
          <div className="flex flex-col gap-4">
            <Card time="17:38">
              <FormBlock block={RESERVE} showHeading />
            </Card>
            <Card time="17:38">
              <FormBlock block={RESERVE_OPEN} showHeading />
            </Card>
          </div>
        </Example>
        <Example label="17 · RATING">
          <div className="flex flex-col gap-4">
            <Card time="20:14">
              <RatingBlock block={SUMMARY} />
            </Card>
            <Card time="20:14">
              <RatingBlock block={SUMMARY_OPEN} />
            </Card>
          </div>
        </Example>
        <Example label="18 · ALERT RULE">
          <div className="flex flex-col gap-4">
            <Card time="09:01">
              <AlertBlock block={BTC_ALERT} showHeading />
            </Card>
            <Card time="09:01">
              <AlertBlock block={BTC_ALERT_OFF} showHeading />
            </Card>
          </div>
        </Example>
        <Example label="08 · CHECKLIST">
          <Card time="18:12">
            <ChecklistBlock block={GROCERIES} showHeading />
          </Card>
        </Example>
      </div>
    </div>
  ),
};
