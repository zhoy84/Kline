"use client";

interface Coin {
  id: number;
  symbol: string;
  name: string;
  active: boolean;
}

interface Props {
  coins: Coin[];
  selected: string;
  onSelect: (symbol: string) => void;
}

export default function CoinSelector({ coins, selected, onSelect }: Props) {
  return (
    <div className="flex gap-1 flex-nowrap">
      {coins.map((coin) => (
        <button
          key={coin.id}
          onClick={() => onSelect(coin.symbol)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
            selected === coin.symbol
              ? "bg-blue-600 text-white shadow-lg shadow-blue-600/25"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
          }`}
        >
          {coin.symbol.replace("USDT", "")}
        </button>
      ))}
    </div>
  );
}
