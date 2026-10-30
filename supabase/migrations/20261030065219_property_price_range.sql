begin;

-- Keep existing fixed prices in price; an upper price makes the listing a range.
alter table public.properties add column price_max numeric(14,2);
alter table public.properties add constraint properties_price_range_check check (
  price_max is null or (
    price is not null and price_max >= price and price_max < 'Infinity'::numeric
  )
);
comment on column public.properties.price_max is 'Optional upper rental price in USD; price stores the lower or fixed price.';

notify pgrst, 'reload schema';
commit;
