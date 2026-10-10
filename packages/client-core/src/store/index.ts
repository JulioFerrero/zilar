// The shared chat store core. One marked section per task of
// docs/STORE_CORE_PLAN.md, so parallel tasks never edit the same line.

// T1 (rows): pure row helpers.
export * from './rows';
// ----------------------------------------------------------------------------
// End of T1.

// T2 (lifetime): add `export * from './<x>';` lines below.
export * from './lifetime';
// ----------------------------------------------------------------------------
// End of T2.

// T3 (ledger): add `export * from './<x>';` lines below.
export * from './ledger';
// ----------------------------------------------------------------------------
// End of T3.

// T6 (ctx, ports, reads, incoming, actions, history): add `export * from './<x>';` lines below.
export * from './ctx';
export * from './ports';
export * from './reads';
export * from './incoming';
export * from './actions';
export * from './history';
// ----------------------------------------------------------------------------
// End of T6.

// T8 (polling, lifecycle): add `export * from './<x>';` lines below.
export * from './polling';
export * from './lifecycle';
// ----------------------------------------------------------------------------
// End of T8.

// T10 (send, send-failure): add `export * from './<x>';` lines below.
export * from './send';
export * from './send-failure';
// ----------------------------------------------------------------------------
// End of T10.

// Phase 2 (T-0919: pins, prefs, folders): add `export * from './<x>';` lines below.
export * from './pins';
export * from './prefs';
export * from './folders';
// T-0920: group detail cache and topic rows.
export * from './groups';
// T-0921: the shared group and topic actions.
export * from './group-actions';
// T-0924: one ChatEntry -> chat-row mapper for both apps.
export * from './chat-rows';
// ----------------------------------------------------------------------------
// End of Phase 2.
