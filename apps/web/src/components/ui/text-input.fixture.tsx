import { SecretInput, TextArea, TextInput } from './text-input';

export default {
  Default: (
    <div className="max-w-sm">
      <TextInput label="Group name" placeholder="Weekend hikers" />
    </div>
  ),
  WithHint: (
    <div className="max-w-sm">
      <TextInput label="Username" hint="Lowercase letters and digits." placeholder="adah" />
    </div>
  ),
  Invalid: (
    <div className="max-w-sm">
      <TextInput
        label="Group name"
        invalid
        hint="A name is required."
        placeholder="Weekend hikers"
      />
    </div>
  ),
  WithCounter: (
    <div className="max-w-sm">
      <TextInput label="Group name" counter={{ max: 64 }} defaultValue="Weekend" />
    </div>
  ),
  SecretInput: (
    <div className="max-w-sm">
      <SecretInput label="API key" placeholder="sk-…" defaultValue="sk-secret" />
    </div>
  ),
  TextArea: (
    <div className="max-w-sm">
      <TextArea
        label="Description"
        hint="Visible to new members."
        placeholder="Tell people what this is about."
      />
    </div>
  ),
  TextAreaInvalid: (
    <div className="max-w-sm">
      <TextArea
        label="Bio"
        invalid
        hint="Too long: 200 characters max."
        counter={{ max: 200 }}
        defaultValue="Hello"
      />
    </div>
  ),
};
