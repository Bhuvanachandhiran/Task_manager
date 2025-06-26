from flask import Flask, render_template, redirect, url_for, flash, request, jsonify, Response
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, login_user, logout_user, current_user, login_required
from flask_wtf import FlaskForm
from flask_mail import Mail, Message
from wtforms import StringField, PasswordField, TextAreaField, SelectField, DateField, SubmitField
from wtforms.validators import DataRequired, Length, Email
from datetime import datetime, timedelta, timezone
import io
import csv
from config import Config
from models import db, User, Task
from forms import LoginForm, RegisterForm, TaskForm
import threading
import time

app = Flask(__name__)
app.config.from_object(Config)
db.init_app(app)
mail = Mail(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))

# Initialize database
with app.app_context():
    db.create_all()

def send_due_date_reminders():
    while True:
        with app.app_context():
            tomorrow = datetime.now(timezone.utc).date() + timedelta(days=1)
            tasks = Task.query.filter(Task.due_date == tomorrow, Task.status != 'Completed').all()
            for task in tasks:
                user = db.session.get(User, task.user_id)
                msg = Message(
                    'Task Due Tomorrow',
                    sender=app.config['MAIL_DEFAULT_SENDER'],
                    recipients=[user.email],
                    body=f"Reminder: Your task '{task.title}' is due on {task.due_date.strftime('%Y-%m-%d')}. Description: {task.description or 'No description'}."
                )
                try:
                    mail.send(msg)
                except Exception as e:
                    print(f"Email sending failed: {e}")
        time.sleep(86400)  # Check daily

@app.route('/')
def index():
    return redirect(url_for('tasks'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('tasks'))
    form = LoginForm()
    if form.validate_on_submit():
        user = db.session.execute(db.select(User).filter_by(email=form.email.data)).scalar_one_or_none()
        if user and user.check_password(form.password.data):
            login_user(user)
            return redirect(url_for('tasks'))
        flash('Invalid email or password')
    return render_template('login.html', form=form)

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if current_user.is_authenticated:
        return redirect(url_for('tasks'))
    form = RegisterForm()
    if form.validate_on_submit():
        existing_user = db.session.execute(db.select(User).filter_by(email=form.email.data)).scalar_one_or_none()
        if existing_user:
            flash('Email already registered. Please use a different email or log in.')
            return render_template('register.html', form=form)
        user = User(email=form.email.data, name=form.name.data)
        user.set_password(form.password.data)
        db.session.add(user)
        try:
            db.session.commit()
            login_user(user)
            flash('Registration successful!')
            return redirect(url_for('tasks'))
        except Exception as e:
            db.session.rollback()
            flash('An error occurred during registration. Please try again.')
    return render_template('register.html', form=form)

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/tasks')
@login_required
def tasks():
    category = request.args.get('category', 'all')
    status = request.args.get('status', 'all')
    sort = request.args.get('sort', 'order')
    query = Task.query.filter_by(user_id=current_user.id)
    if category != 'all':
        query = query.filter_by(category=category)
    if status != 'all':
        query = query.filter_by(status=status)
    if sort == 'due_date_asc':
        query = query.order_by(Task.due_date.asc())
    elif sort == 'due_date_desc':
        query = query.order_by(Task.due_date.desc())
    elif sort == 'priority':
        query = query.order_by(Task.priority.asc())
    else:
        query = query.order_by(Task.order.asc())
    tasks = query.all()
    return render_template('tasks.html', tasks=tasks, category=category, status=status, sort=sort, now=datetime.now(timezone.utc).date())

@app.route('/api/tasks', methods=['GET'])
@login_required
def api_tasks():
    category = request.args.get('category', 'all')
    status = request.args.get('status', 'all')
    sort = request.args.get('sort', 'order')
    query = Task.query.filter_by(user_id=current_user.id)
    if category != 'all':
        query = query.filter_by(category=category)
    if status != 'all':
        query = query.filter_by(status=status)
    if sort == 'due_date_asc':
        query = query.order_by(Task.due_date.asc())
    elif sort == 'due_date_desc':
        query = query.order_by(Task.due_date.desc())
    elif sort == 'priority':
        query = query.order_by(Task.priority.asc())
    else:
        query = query.order_by(Task.order.asc())
    tasks = query.all()
    return jsonify([{
        'id': task.id,
        'title': task.title,
        'description': task.description,
        'category': task.category,
        'due_date': task.due_date.strftime('%Y-%m-%d'),
        'status': task.status,
        'priority': task.priority,
        'tags': task.tags,
        'order': task.order,
        'time_spent': task.time_spent,
        'notes': task.notes,
        'progress': task.progress,
        'is_overdue': task.due_date < datetime.now(timezone.utc).date() and task.status != 'Completed'
    } for task in tasks])

@app.route('/add_task', methods=['GET', 'POST'])
@login_required
def add_task():
    form = TaskForm()
    if form.validate_on_submit():
        max_order = db.session.query(db.func.max(Task.order)).filter_by(user_id=current_user.id).scalar() or 0
        task = Task(
            title=form.title.data,
            description=form.description.data,
            category=form.category.data,
            due_date=form.due_date.data,
            status=form.status.data,
            priority=form.priority.data,
            tags=form.tags.data,
            user_id=current_user.id,
            order=max_order + 1
        )
        db.session.add(task)
        db.session.commit()
        flash('Task added successfully!')
        return redirect(url_for('tasks'))
    return render_template('add_task.html', form=form)

@app.route('/edit_task/<int:task_id>', methods=['GET', 'POST'])
@login_required
def edit_task(task_id):
    task = Task.query.get_or_404(task_id)
    if task.user_id != current_user.id:
        flash('You can only edit your own tasks.')
        return redirect(url_for('tasks'))
    form = TaskForm(obj=task)
    if form.validate_on_submit():
        task.title = form.title.data
        task.description = form.description.data
        task.category = form.category.data
        task.due_date = form.due_date.data
        task.status = form.status.data
        task.priority = form.priority.data
        task.tags = form.tags.data
        db.session.commit()
        flash('Task updated successfully!')
        return redirect(url_for('tasks'))
    return render_template('edit_task.html', form=form, task=task)

@app.route('/delete_task/<int:task_id>', methods=['POST'])
@login_required
def delete_task(task_id):
    task = Task.query.get_or_404(task_id)
    if task.user_id != current_user.id:
        flash('You can only delete your own tasks.')
        return redirect(url_for('tasks'))
    db.session.delete(task)
    db.session.commit()
    flash('Task deleted successfully!')
    return redirect(url_for('tasks'))

@app.route('/api/mark_complete/<int:task_id>', methods=['POST'])
@login_required
def mark_complete(task_id):
    task = Task.query.get_or_404(task_id)
    if task.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    task.status = 'Completed'
    task.progress = 100
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/reorder_tasks', methods=['POST'])
@login_required
def reorder_tasks():
    data = request.get_json()
    task_orders = data.get('task_orders', [])
    for task_order in task_orders:
        task_id = task_order['id']
        order = task_order['order']
        task = Task.query.get_or_404(task_id)
        if task.user_id != current_user.id:
            return jsonify({'error': 'Unauthorized'}), 403
        task.order = order
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/update_time/<int:task_id>', methods=['POST'])
@login_required
def update_time(task_id):
    task = Task.query.get_or_404(task_id)
    if task.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.get_json()
    task.time_spent = data.get('time_spent', task.time_spent)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/update_notes/<int:task_id>', methods=['POST'])
@login_required
def update_notes(task_id):
    task = Task.query.get_or_404(task_id)
    if task.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.get_json()
    task.notes = data.get('notes', task.notes)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/update_progress/<int:task_id>', methods=['POST'])
@login_required
def update_progress(task_id):
    task = Task.query.get_or_404(task_id)
    if task.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    data = request.get_json()
    progress = data.get('progress', task.progress)
    if not isinstance(progress, int) or progress < 0 or progress > 100:
        return jsonify({'error': 'Invalid progress value'}), 400
    task.progress = progress
    if progress == 100:
        task.status = 'Completed'
    elif task.status == 'Completed' and progress < 100:
        task.status = 'In Progress'
    db.session.commit()
    return jsonify({'success': True})

@app.route('/dashboard')
@login_required
def dashboard():
    tasks = Task.query.filter_by(user_id=current_user.id).all()
    status_counts = {'Pending': 0, 'In Progress': 0, 'Completed': 0}
    priority_counts = {'High': 0, 'Medium': 0, 'Low': 0}
    for task in tasks:
        status_counts[task.status] = status_counts.get(task.status, 0) + 1
        priority_counts[task.priority] = priority_counts.get(task.priority, 0) + 1
    return render_template('dashboard.html', status_counts=status_counts, priority_counts=priority_counts)

@app.route('/export_tasks', methods=['GET'])
@login_required
def export_tasks():
    def format_time(seconds):
        h = seconds // 3600
        m = (seconds % 3600) // 60
        s = seconds % 60
        return f"{h:02d}:{m:02d}:{s:02d}"
    tasks = Task.query.filter_by(user_id=current_user.id).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['ID', 'Title', 'Description', 'Category', 'Due Date', 'Status', 'Priority', 'Tags', 'Time Spent', 'Notes', 'Progress'])
    for task in tasks:
        writer.writerow([
            task.id,
            task.title,
            task.description or '',
            task.category,
            task.due_date.strftime('%Y-%m-%d'),
            task.status,
            task.priority,
            task.tags or '',
            format_time(task.time_spent),
            task.notes or '',
            task.progress
        ])
    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': 'attachment;filename=tasks.csv'}
    )

if __name__ == '__main__':
    threading.Thread(target=send_due_date_reminders, daemon=True).start()
    app.run(debug=True)