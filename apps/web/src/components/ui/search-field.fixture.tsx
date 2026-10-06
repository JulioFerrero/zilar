import { SearchField } from './search-field';

export default {
  Default: (
    <div className="max-w-sm">
      <SearchField aria-label="Search" placeholder="Search" />
    </div>
  ),
  WithValue: (
    <div className="max-w-sm">
      <SearchField aria-label="Search" placeholder="Search" defaultValue="Weekend hikers" />
    </div>
  ),
  Disabled: (
    <div className="max-w-sm">
      <SearchField aria-label="Search" placeholder="Search" disabled />
    </div>
  ),
};
