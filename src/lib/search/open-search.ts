/**
 * How anything in the admin asks for the search panel.
 *
 * The search field lives in the topbar; the things that need to open it on a
 * phone — the bottom island, its "More" sheet — live in a different branch of
 * the layout tree, with a server component in between. Lifting the open state
 * high enough to be shared would mean turning that part of the layout into a
 * client component and threading a prop through it.
 *
 * A window event costs neither. The publisher does not import the search, the
 * search does not know its publishers, and nothing in between has to become
 * interactive to pass the message along.
 */
export const OPEN_SEARCH_EVENT = "admin:open-search";

export function openAdminSearch() {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}
