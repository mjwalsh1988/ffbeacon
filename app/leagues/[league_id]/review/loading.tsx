import { OrderSkeleton } from "@/components/commerce/order-skeleton";

export default function Loading() {
  return (
    <main id="main" className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <OrderSkeleton label="Loading the order form for this team." />
    </main>
  );
}
