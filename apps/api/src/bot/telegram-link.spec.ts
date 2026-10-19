import { phoneCandidates, verifiedOwnPhone } from './telegram-link';

describe('verifiedOwnPhone', () => {
  it('accepts the sender’s own shared contact', () => {
    expect(
      verifiedOwnPhone({ phone_number: '+855 12 345 678', user_id: 42 }, 42),
    ).toBe('85512345678');
  });

  it('refuses a contact card belonging to someone else', () => {
    expect(
      verifiedOwnPhone({ phone_number: '85512345678', user_id: 7 }, 42),
    ).toBeNull();
  });

  it('refuses a contact with no Telegram user behind it', () => {
    expect(verifiedOwnPhone({ phone_number: '85512345678' }, 42)).toBeNull();
  });

  it('refuses when there is no contact or no sender', () => {
    expect(verifiedOwnPhone(undefined, 42)).toBeNull();
    expect(
      verifiedOwnPhone({ phone_number: '85512345678', user_id: 42 }, undefined),
    ).toBeNull();
  });
});

describe('phoneCandidates', () => {
  it('covers international and national spellings of a Cambodian number', () => {
    expect(phoneCandidates('85512345678')).toEqual(
      expect.arrayContaining([
        '85512345678',
        '+85512345678',
        '012345678',
        '12345678',
      ]),
    );
  });

  it('maps a national number to its international forms', () => {
    expect(phoneCandidates('012345678')).toEqual(
      expect.arrayContaining(['012345678', '85512345678', '+85512345678']),
    );
  });
});
