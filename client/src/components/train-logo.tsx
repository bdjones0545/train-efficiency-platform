import logoPath from "@assets/ChatGPT_Image_Jun_25,_2026_at_10_52_41_PM_1782442451799.png";

interface TrainLogoProps {
  className?: string;
  alt?: string;
}

export function TrainLogo({ className = "h-5 w-5", alt = "TrainEfficiency" }: TrainLogoProps) {
  return (
    <img
      src={logoPath}
      alt={alt}
      className={`${className} object-contain`}
    />
  );
}
