/**
 * Confetti animation hook using GSAP
 * TODO: Install GSAP and implement full confetti burst
 */

export function useConfetti() {
  const fireConfetti = (targetElement?: HTMLElement) => {
    // TODO: Implement GSAP confetti burst animation
    // Placeholder: Create simple particle effects
    // When GSAP is installed, replace with proper timeline animation
    // Example timeline:
    // const tl = gsap.timeline();
    // tl.to(particles, { y: -200, opacity: 0, duration: 1.5, stagger: 0.02 });
  };

  return { fireConfetti };
}
