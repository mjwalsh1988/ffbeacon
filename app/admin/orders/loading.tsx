import { OrderSkeleton } from "@/components/commerce/order-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl">
      <OrderSkeleton label="Loading orders." />
    </div>
  );
}
