-- Two more couriers: DTDC and Delhivery.
--
-- 0034 built the courier tables for Shree Maruti and Blue Dart and pinned the
-- `provider` column to those two with a check constraint, on the reasoning
-- that a typo in a provider slug should fail loudly rather than create a
-- shipment nothing can find. That reasoning still holds; the list just grows.
--
-- Everything else — the shipment row, the settings singleton, the label
-- bucket, the credentials table — already fits: DTDC's API key and Delhivery's
-- token go in `client_secret`, DTDC's tracking password in `extra_secret`,
-- and the per-courier oddities (DTDC's customer code and commodity id,
-- Delhivery's registered warehouse name) in `settings`.

alter table courier_shipments
  drop constraint if exists courier_shipments_provider_check;

alter table courier_shipments
  add constraint courier_shipments_provider_check
  check (provider in ('shreemaruti', 'bluedart', 'dtdc', 'delhivery'));

comment on column courier_shipments.provider is
  'Which courier: shreemaruti, bluedart, dtdc or delhivery — the slugs in src/lib/couriers/providers.ts.';
