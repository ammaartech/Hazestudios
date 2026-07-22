-- Storefront demo catalog.
--
-- Real rows in the real schema — the admin can edit or delete any of it. Every
-- id is deterministic and every insert is `on conflict do nothing`, so this is
-- safe to run more than once and safe to run after the same rows were pushed in
-- over the REST API.
--
-- IMAGERY IS PLACEHOLDER. Image URLs point at picsum.photos so the editorial
-- layout can be judged with real photography in place. Swap them for actual
-- Hazestudios product shots in the product-images bucket before launch.

-- ---------------------------------------------------------------------------
-- Collections
-- ---------------------------------------------------------------------------
insert into collections (id, title, handle, description, type, image_url) values
  ('22222222-0000-4000-8000-000000000001', 'SS26 — Drop 01', 'ss26-drop-01',
   'The first release of the spring season. Cut in Portugal, washed twice, finished by hand.',
   'manual', 'https://picsum.photos/seed/haze-col-drop01/2000/1200'),
  ('22222222-0000-4000-8000-000000000002', 'Outerwear', 'outerwear',
   'Shells, jackets and coats built for weather and for wear.',
   'manual', 'https://picsum.photos/seed/haze-col-outer/2000/1200'),
  ('22222222-0000-4000-8000-000000000003', 'Knitwear', 'knitwear',
   'Mohair, lambswool and heavy-gauge cotton. Made to soften with age.',
   'manual', 'https://picsum.photos/seed/haze-col-knit/2000/1200'),
  ('22222222-0000-4000-8000-000000000004', 'Archive', 'archive',
   'Past-season pieces held back from the original run.',
   'manual', 'https://picsum.photos/seed/haze-col-archive/2000/1200')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
insert into products (id, title, description_html, status, vendor, product_type, tags, price, compare_at_price, sku, track_inventory, has_variants, seo_title, seo_description) values
  ('11111111-0000-4000-8000-000000000001', 'Boxed Logo Tee',
   '<p>Heavyweight 260gsm cotton jersey, garment-dyed and washed twice for a lived-in hand. Boxy body, dropped shoulder, ribbed collar.</p><p>Made in Portugal.</p>',
   'active', 'Hazestudios', 'T-Shirt', '{"tee","cotton","ss26"}', 68.00, null, 'HZ-TEE-001', true, true,
   'Boxed Logo Tee', 'Heavyweight garment-dyed cotton tee with a boxy fit.'),

  ('11111111-0000-4000-8000-000000000002', 'Washed Cotton Hoodie',
   '<p>Loopback cotton fleece at 480gsm, enzyme-washed to break down the surface. Twin-needle stitching throughout, self-fabric drawcord.</p>',
   'active', 'Hazestudios', 'Hoodie', '{"fleece","cotton","ss26"}', 165.00, null, 'HZ-HOD-001', true, true,
   'Washed Cotton Hoodie', 'Enzyme-washed loopback cotton hoodie in heavyweight fleece.'),

  ('11111111-0000-4000-8000-000000000003', 'Panelled Work Jacket',
   '<p>A chore jacket rebuilt across nine panels in dry cotton canvas. Unlined, triple-stitched, with corozo buttons that dull as they wear.</p>',
   'active', 'Hazestudios', 'Outerwear', '{"jacket","canvas","ss26"}', 340.00, 420.00, 'HZ-JKT-001', true, true,
   'Panelled Work Jacket', 'Nine-panel dry cotton canvas chore jacket.'),

  ('11111111-0000-4000-8000-000000000004', 'Mohair Knit Crew',
   '<p>Brushed kid mohair blended with merino on a five-gauge machine. Deliberately open and airy — halo softens over the first few wears.</p>',
   'active', 'Hazestudios', 'Knitwear', '{"knit","mohair"}', 210.00, null, 'HZ-KNT-001', true, true,
   'Mohair Knit Crew', 'Five-gauge brushed kid mohair and merino crew neck.'),

  ('11111111-0000-4000-8000-000000000005', 'Wide-Leg Denim',
   '<p>14oz Japanese selvedge, woven on shuttle looms and left raw. Cut wide through the thigh with a full straight leg and a single-stitch hem.</p>',
   'active', 'Hazestudios', 'Denim', '{"denim","selvedge","ss26"}', 190.00, null, 'HZ-DNM-001', true, true,
   'Wide-Leg Denim', '14oz raw Japanese selvedge denim in a wide straight leg.'),

  ('11111111-0000-4000-8000-000000000006', 'Technical Shell',
   '<p>Three-layer waterproof membrane rated to 20k/20k, fully taped. Articulated sleeves, storm flap, packs into its own chest pocket.</p>',
   'active', 'Hazestudios', 'Outerwear', '{"shell","technical"}', 480.00, null, 'HZ-SHL-001', true, true,
   'Technical Shell', 'Three-layer 20k/20k waterproof taped shell.'),

  ('11111111-0000-4000-8000-000000000007', 'Ribbed Beanie',
   '<p>Fine-gauge lambswool rib, knitted in Scotland. Long enough to wear folded or slouched.</p>',
   'active', 'Hazestudios', 'Accessories', '{"knit","accessory"}', 55.00, null, 'HZ-ACC-001', true, true,
   'Ribbed Beanie', 'Scottish lambswool ribbed beanie.'),

  ('11111111-0000-4000-8000-000000000008', 'Cargo Trouser',
   '<p>Cotton ripstop with bellowed thigh pockets and a webbing waist adjuster. Tapers below the knee to sit clean over a boot.</p>',
   'active', 'Hazestudios', 'Trouser', '{"cargo","ripstop","ss26"}', 220.00, null, 'HZ-TRS-001', true, true,
   'Cargo Trouser', 'Cotton ripstop cargo trouser with bellowed pockets.'),

  ('11111111-0000-4000-8000-000000000009', 'Heavyweight Sweatpant',
   '<p>The hoodie''s counterpart in the same 480gsm loopback. Tapered leg, ribbed cuff, side seam pockets.</p>',
   'active', 'Hazestudios', 'Trouser', '{"fleece","cotton"}', 145.00, 180.00, 'HZ-SWP-001', true, true,
   'Heavyweight Sweatpant', '480gsm loopback cotton sweatpant with a tapered leg.'),

  ('11111111-0000-4000-8000-000000000010', 'Distressed Cardigan',
   '<p>Hand-finished holes and pulled stitches across a heavy lambswool ground. No two are identical.</p>',
   'active', 'Hazestudios', 'Knitwear', '{"knit","lambswool"}', 265.00, null, 'HZ-KNT-002', true, true,
   'Distressed Cardigan', 'Hand-distressed heavy lambswool cardigan.'),

  ('11111111-0000-4000-8000-000000000011', 'Leather Bomber',
   '<p>Vegetable-tanned lambskin, quilted viscose lining, ribbed collar and cuff. Softens and marks with wear by design.</p>',
   'active', 'Hazestudios', 'Outerwear', '{"leather","jacket"}', 720.00, null, 'HZ-JKT-002', true, true,
   'Leather Bomber', 'Vegetable-tanned lambskin bomber with quilted lining.'),

  ('11111111-0000-4000-8000-000000000012', 'Logo Cap',
   '<p>Six-panel washed cotton twill with an embroidered mark and a brass slider.</p>',
   'active', 'Hazestudios', 'Accessories', '{"cap","accessory"}', 60.00, null, 'HZ-ACC-002', true, true,
   'Logo Cap', 'Washed cotton twill six-panel cap.'),

  -- Draft on purpose: proves the public RLS policy hides non-active products.
  ('11111111-0000-4000-8000-000000000013', 'Unreleased Sample Tee',
   '<p>Internal sample. Should never be visible on the storefront.</p>',
   'draft', 'Hazestudios', 'T-Shirt', '{"sample"}', 0.00, null, 'HZ-SAMPLE', true, false,
   '', '')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Collection membership
-- ---------------------------------------------------------------------------
insert into product_collections (product_id, collection_id) values
  ('11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001'),
  ('11111111-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000001'),
  ('11111111-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000001'),
  ('11111111-0000-4000-8000-000000000005', '22222222-0000-4000-8000-000000000001'),
  ('11111111-0000-4000-8000-000000000008', '22222222-0000-4000-8000-000000000001'),
  ('11111111-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000002'),
  ('11111111-0000-4000-8000-000000000006', '22222222-0000-4000-8000-000000000002'),
  ('11111111-0000-4000-8000-000000000011', '22222222-0000-4000-8000-000000000002'),
  ('11111111-0000-4000-8000-000000000004', '22222222-0000-4000-8000-000000000003'),
  ('11111111-0000-4000-8000-000000000010', '22222222-0000-4000-8000-000000000003'),
  ('11111111-0000-4000-8000-000000000007', '22222222-0000-4000-8000-000000000003'),
  ('11111111-0000-4000-8000-000000000009', '22222222-0000-4000-8000-000000000004'),
  ('11111111-0000-4000-8000-000000000012', '22222222-0000-4000-8000-000000000004'),
  ('11111111-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000004')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Images — two per product, for the PDP gallery.
-- ---------------------------------------------------------------------------
insert into product_images (id, product_id, url, alt, position)
select
  ('33333333-0000-4000-8000-' || lpad((n * 10 + pos)::text, 12, '0'))::uuid,
  ('11111111-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'https://picsum.photos/seed/haze-p' || n || '-' || pos || '/1400/1750',
  p.title || ' — view ' || pos,
  pos
from generate_series(1, 12) as n
cross join generate_series(0, 1) as pos
join products p on p.id = ('11111111-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Options
-- ---------------------------------------------------------------------------
insert into product_options (id, product_id, name, "values", position) values
  -- Apparel sizing
  ('44444444-0000-4000-8000-000000000101', '11111111-0000-4000-8000-000000000001', 'Size', '{"XS","S","M","L","XL"}', 0),
  ('44444444-0000-4000-8000-000000000201', '11111111-0000-4000-8000-000000000002', 'Size', '{"S","M","L","XL"}', 0),
  ('44444444-0000-4000-8000-000000000301', '11111111-0000-4000-8000-000000000003', 'Size', '{"S","M","L","XL"}', 0),
  ('44444444-0000-4000-8000-000000000401', '11111111-0000-4000-8000-000000000004', 'Size', '{"S","M","L","XL"}', 0),
  ('44444444-0000-4000-8000-000000000601', '11111111-0000-4000-8000-000000000006', 'Size', '{"S","M","L","XL"}', 0),
  ('44444444-0000-4000-8000-000000000901', '11111111-0000-4000-8000-000000000009', 'Size', '{"S","M","L","XL"}', 0),
  ('44444444-0000-4000-8000-000000001001', '11111111-0000-4000-8000-000000000010', 'Size', '{"S","M","L","XL"}', 0),
  ('44444444-0000-4000-8000-000000001101', '11111111-0000-4000-8000-000000000011', 'Size', '{"S","M","L","XL"}', 0),
  -- Waist sizing
  ('44444444-0000-4000-8000-000000000501', '11111111-0000-4000-8000-000000000005', 'Size', '{"28","30","32","34","36"}', 0),
  ('44444444-0000-4000-8000-000000000801', '11111111-0000-4000-8000-000000000008', 'Size', '{"28","30","32","34","36"}', 0),
  -- One-size accessories still get an option so the PDP has a consistent shape
  ('44444444-0000-4000-8000-000000000701', '11111111-0000-4000-8000-000000000007', 'Size', '{"One Size"}', 0),
  ('44444444-0000-4000-8000-000000001201', '11111111-0000-4000-8000-000000000012', 'Size', '{"One Size"}', 0),
  -- Second axis on two products, to exercise multi-option variant selection
  ('44444444-0000-4000-8000-000000000102', '11111111-0000-4000-8000-000000000001', 'Colour', '{"Bone","Black"}', 1),
  ('44444444-0000-4000-8000-000000000302', '11111111-0000-4000-8000-000000000003', 'Colour', '{"Slate","Olive"}', 1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Variants — generated as the cross product of each product's options, so the
-- variant set always matches the options above rather than drifting from them.
-- ---------------------------------------------------------------------------
do $$
declare
  prod record;
  opt1 product_options%rowtype;
  opt2 product_options%rowtype;
  v1 text;
  v2 text;
  pos int;
  vid uuid;
begin
  for prod in
    select p.* from products p
    where p.id between '11111111-0000-4000-8000-000000000001'
                   and '11111111-0000-4000-8000-000000000012'
  loop
    select * into opt1 from product_options
      where product_id = prod.id and position = 0;
    select * into opt2 from product_options
      where product_id = prod.id and position = 1;

    continue when opt1.id is null;

    pos := 0;
    foreach v1 in array opt1."values" loop
      if opt2.id is null then
        vid := md5('variant:' || prod.id::text || ':' || v1)::uuid;
        insert into product_variants (id, product_id, title, option1, option2, price, compare_at_price, sku, position)
        values (vid, prod.id, v1, v1, null, prod.price, prod.compare_at_price,
                prod.sku || '-' || upper(replace(v1, ' ', '')), pos)
        on conflict (id) do nothing;
        pos := pos + 1;
      else
        foreach v2 in array opt2."values" loop
          vid := md5('variant:' || prod.id::text || ':' || v1 || ':' || v2)::uuid;
          insert into product_variants (id, product_id, title, option1, option2, price, compare_at_price, sku, position)
          values (vid, prod.id, v1 || ' / ' || v2, v1, v2, prod.price, prod.compare_at_price,
                  prod.sku || '-' || upper(replace(v1, ' ', '')) || '-' || upper(left(v2, 3)), pos)
          on conflict (id) do nothing;
          pos := pos + 1;
        end loop;
      end if;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Inventory — stock every variant at the default location, then deliberately
-- zero out a spread of sizes so the out-of-stock states are actually reachable.
-- ---------------------------------------------------------------------------
do $$
declare
  loc uuid;
begin
  select id into loc from locations where is_default order by created_at limit 1;
  if loc is null then
    select id into loc from locations order by created_at limit 1;
  end if;
  if loc is null then
    raise exception 'no location exists to stock inventory against';
  end if;

  insert into inventory_levels (id, product_id, variant_id, location_id, quantity)
  select
    md5('inv:' || v.id::text)::uuid,
    v.product_id,
    v.id,
    loc,
    -- Edge sizes run thin, middle sizes deep.
    case when v.option1 in ('XS', 'XL', '28', '36') then 2 else 14 end
  from product_variants v
  where v.product_id between '11111111-0000-4000-8000-000000000001'
                         and '11111111-0000-4000-8000-000000000012'
  on conflict (id) do nothing;

  -- Single sold-out size on the tee.
  update inventory_levels il set quantity = 0
  from product_variants v
  where v.id = il.variant_id
    and v.product_id = '11111111-0000-4000-8000-000000000001'
    and v.option1 = 'XS';

  -- Fully sold-out product, to exercise the sold-out card + disabled PDP CTA.
  update inventory_levels il set quantity = 0
  from product_variants v
  where v.id = il.variant_id
    and v.product_id = '11111111-0000-4000-8000-000000000003';

  -- Low stock, to exercise the "last few" messaging.
  update inventory_levels il set quantity = 1
  from product_variants v
  where v.id = il.variant_id
    and v.product_id = '11111111-0000-4000-8000-000000000011'
    and v.option1 in ('S', 'XL');
end $$;
