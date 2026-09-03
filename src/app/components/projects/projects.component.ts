import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  QueryList,
  ViewChildren,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';

interface Project {
  id: string;
  title: string;
  subtitle: string;
  lede: string;
  contribution: string;
  stack: string[];
}

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './projects.component.html',
  styleUrl: './projects.component.css',
})
export class ProjectsComponent implements AfterViewInit, OnDestroy {
  projects: Project[] = [
    {
      id: 'flexschema',
      title: 'Flexschema',
      subtitle: 'Enterprise CRM Platform',
      lede: 'A comprehensive CRM solution for modern businesses, built end-to-end in Angular. Configurable module system, role-based access control, and a robust state architecture that scales.',
      contribution: 'Frontend architecture, reusable component system, RxJS state flow, API integration layer, and unit-test coverage.',
      stack: ['Angular', 'TypeScript', 'RxJS', 'NgRx']
    },
    {
      id: 'datamesh',
      title: 'DataMesh',
      subtitle: 'Real-time Analytics Dashboard',
      lede: 'High-performance data visualization interface handling millions of data points with WebGL and Angular. Implemented custom change detection strategies to ensure 60fps rendering.',
      contribution: 'Dashboard layout engine, D3.js integration, WebSocket real-time updates, performance tuning.',
      stack: ['Angular', 'D3.js', 'WebSockets', 'SCSS']
    },
    {
      id: 'nexus',
      title: 'Nexus UI',
      subtitle: 'Component Library',
      lede: 'A deeply accessible, themeable Angular component library. Used across 15+ internal applications to maintain a consistent design language and reduce development time.',
      contribution: 'Core component development, accessibility auditing (a11y), Storybook documentation, CI/CD publishing pipeline.',
      stack: ['Angular', 'Storybook', 'SCSS', 'A11y']
    }
  ];

  activeProjectIndex = 0;
  private observer: IntersectionObserver | null = null;
  @ViewChildren('projectEl') projectElements!: QueryList<ElementRef>;

  constructor(private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset['index']);
            if (this.activeProjectIndex !== index) {
              this.activeProjectIndex = index;
              this.cdr.detectChanges();
            }
          }
        });
      }, {
        rootMargin: '-30% 0px -30% 0px',
        threshold: 0
      });

      this.projectElements.forEach(el => {
        this.observer?.observe(el.nativeElement);
      });
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
