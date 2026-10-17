/**
 * Closet services — earned and purchased digital items, drops, trading.
 * Barrel export for all closet-related services.
 */
export * from "./closet.catalog";
export * from "./closet.wallet";
export * from "./closet.drops";
export * from "./closet.trading";
export * from "./closet.shop";
export { fetchLockerItems, type LockerItem } from "./locker";
