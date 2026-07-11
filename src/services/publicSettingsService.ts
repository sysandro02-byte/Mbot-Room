export type MeetingAdSlide = {
  id: string;
  title: string;
  description?: string;
  text: string;
  image: string;
  imageUrl?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  active: boolean;
};

export const defaultPublicSettings = {
  meetingAdSlides: [
    {
      id: 'team',
      title: 'Réunion sécurisée',
      description: 'Audio, vidéo, lobby et partage de lien.',
      text: 'Audio, vidéo, lobby et partage de lien.',
      image: '/meeting-black-team.svg',
      imageUrl: '/meeting-black-team.svg',
      ctaLabel: 'Ouvrir',
      active: true,
    },
  ] satisfies MeetingAdSlide[],
};

export const publicSettingsService = {
  async getPublicSettings() {
    return defaultPublicSettings;
  },
};
