import {
  Component,
  HostListener,
  HostBinding,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';

interface NavLink {
  readonly id: string;
  readonly label: string;
  readonly num: string;
}

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.component.html',
  styleUrl: './header.component.css',
})
export class HeaderComponent implements AfterViewInit, OnDestroy {
  readonly navLinks: ReadonlyArray<NavLink> = [
    { id: 'home',       label: 'Home',       num: '·' },
    { id: 'about',      label: 'About',      num: '01' },
    { id: 'experience', label: 'Experience', num: '02' },
    { id: 'projects',   label: 'Projects',   num: '03' },
    { id: 'contact',    label: 'Contact',    num: '04' },
  ];

  @HostBinding('class.menu-open') menuOpen = false;
  @HostBinding('class.scrolled') isScrolled = false;
  activeSection = 'home';

  private observer: IntersectionObserver | null = null;
  private rafId = 0;

  private allSections = ['home', 'about', 'experience', 'skills', 'projects', 'contact'];

  ngAfterViewInit(): void {
    const targets = this.allSections
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (!targets.length) return;

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            // Map sub-sections to nearest nav anchor
            if (id === 'skills') this.activeSection = 'experience';
            else this.activeSection = id;
          }
        }
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: 0 }
    );

    targets.forEach((el) => this.observer!.observe(el));
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (
      this.menuOpen &&
      !target.closest('.site-nav') &&
      !target.closest('.hamburger')
    ) {
      this.closeMenu();
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.menuOpen) this.closeMenu();
  }

  @HostListener('window:scroll')
  onScroll(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.isScrolled = window.scrollY > 20;
      this.rafId = 0;
    });
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
    document.body.classList.toggle('menu-open', this.menuOpen);
  }

  closeMenu(): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    document.body.classList.remove('menu-open');
  }
}
