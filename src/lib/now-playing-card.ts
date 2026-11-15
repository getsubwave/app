// On iOS a card
// with a cover downloads it again (Android's RNTP patch skips an unchanged
// one), so a card goes out only when a new RNTP track item was loaded, that
// item first plays, or something the card carries changes.
//
// A load (tune-in, every reconnect, a lock-screen Play) resets the native card
// to the item's own placeholder strings: iOS's AudioPlayer.load rewrites
// title, artist, album and artwork from the item, and on Android the
// media-item transition drops KotlinAudio's metadata override while
// MusicService.load forgets the last card. Both happen before RNTP emits
// PlaybackActiveTrackChanged, so a card sent on that event lands after the
// reset. A card that fails to send needs no retry: iOS refuses one only before
// the player is set up and Android only while no item is loaded, and the load
// that follows brings the event.
//
// A cover download that fails says nothing to JS: iOS's Metadata.update drops
// the error, and KotlinAudio's Coil target handles success only. A load comes
// just when the link is suspect, so the cover waits for the item's first
// `playing`, which proves the link. Until then a card carries the strings and
// an empty artwork, which starts no download and cancels one left over from
// the last item.
//
// A status flip still needs one: on every
// player state change iOS rewrites elapsed and duration from the stream's own
// clock.

export interface SentCard {
  title: string;
  artist: string | undefined;
  album: string | undefined;
  artwork: string | undefined;
  item: number;
  played: boolean;
}

export function hasPlayed(last: SentCard | null, item: number, playing: boolean): boolean {
  return playing || (last !== null && last.item === item && last.played);
}

export function sendsCard(last: SentCard | null, next: SentCard): boolean {
  return (
    last === null ||
    last.item !== next.item ||
    last.played !== next.played ||
    last.title !== next.title ||
    last.artist !== next.artist ||
    last.album !== next.album ||
    (next.played && last.artwork !== next.artwork)
  );
}

/** The artwork a card carries: the cover once its item has played. Empty
 *  clears it on both platforms and starts no download. */
export function cardArtwork(card: SentCard): string {
  return card.played ? card.artwork ?? '' : '';
}
